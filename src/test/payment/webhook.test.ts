/**
 * Creem Webhook 集成测试
 *
 * 测试范围：
 * - checkout.completed 事件处理
 *   - 订阅支付完成 → 创建/更新订阅记录
 *   - 一次性支付（Lifetime）→ 创建终身订阅
 *   - 积分购买 → 发放积分
 * - subscription.active 事件处理
 * - subscription.renewed 事件处理
 * - subscription.canceled 事件处理
 *
 * 注意：这些测试模拟 Creem 事件数据，不实际调用 Creem API
 */

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  handleCheckoutCompleted,
  handleSubscriptionActive,
  handleSubscriptionRenewed,
} from "@/app/api/webhooks/creem/route";
import { PRICE_IDS } from "@/config/payment";
import {
  commissionBalance,
  commissionEvent,
  commissionLedger,
  commissionRecord,
  commissionRule,
  distributionAttribution,
  salesAfterSalesEvent,
  salesOrder,
  salesOrderItem,
  subscription,
} from "@/db/schema";
import { CREDITS_EXPIRY_DAYS } from "@/features/credits/config";
import {
  releaseAvailableCommissionRecords,
  settleCommissionForSalesOrder,
} from "@/features/distribution/commission";
import { applySalesAfterSalesEvent } from "@/features/distribution/orders";
import type {
  CreemCheckoutCompletedData,
  CreemSubscription,
} from "@/features/payment/creem";
import {
  cleanupTestUsers,
  createTestDistributionProfile,
  createTestReferralCode,
  createTestSubscription,
  createTestUser,
  getUserCreditsState,
  getUserSubscription,
  testDb,
} from "../utils";

/**
 * 获取用户的统一订单及订单项
 */
async function getUserSalesOrders(userId: string) {
  const orders = await testDb
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.userId, userId));

  if (orders.length === 0) {
    return [];
  }

  const items = await testDb
    .select()
    .from(salesOrderItem)
    .where(
      inArray(
        salesOrderItem.orderId,
        orders.map((order) => order.id)
      )
    );

  return orders.map((order) => ({
    order,
    items: items.filter((item) => item.orderId === order.id),
  }));
}

// 收集测试中创建的用户 ID，用于清理
const createdUserIds: string[] = [];
const createdCommissionRuleIds: string[] = [];
const proMonthlyPriceId = PRICE_IDS.PRO_MONTHLY;

// 测试后清理
afterAll(async () => {
  if (createdCommissionRuleIds.length > 0) {
    await testDb
      .delete(commissionRule)
      .where(inArray(commissionRule.id, createdCommissionRuleIds));
  }
  await cleanupTestUsers(createdUserIds);
});

// ============================================
// 模拟 Creem Webhook 处理器逻辑
// (从 webhooks/creem/route.ts 提取核心逻辑)
// ============================================

/**
 * 处理一次性支付完成事件（Lifetime 计划）
 */
async function handleOneTimePaymentCompleted(params: {
  userId: string;
  paymentIntentId: string;
  planId?: string;
}) {
  const { userId, paymentIntentId, planId } = params;

  const [existingSubscription] = await testDb
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);

  if (existingSubscription) {
    await testDb
      .update(subscription)
      .set({
        subscriptionId: `lifetime_${paymentIntentId}`,
        priceId: planId ?? "lifetime",
        status: "lifetime",
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscription.userId, userId));
  } else {
    await testDb.insert(subscription).values({
      id: crypto.randomUUID(),
      userId,
      subscriptionId: `lifetime_${paymentIntentId}`,
      priceId: planId ?? "lifetime",
      status: "lifetime",
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  }
}

/**
 * 处理订阅创建事件
 */
async function handleSubscriptionCreated(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}) {
  const {
    userId,
    subscriptionId,
    priceId,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  } = params;

  const [existingSubscription] = await testDb
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);

  if (!existingSubscription) {
    await testDb.insert(subscription).values({
      id: crypto.randomUUID(),
      userId,
      subscriptionId,
      priceId,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd,
    });
  }
}

/**
 * 处理订阅更新事件
 */
async function handleSubscriptionUpdated(params: {
  subscriptionId: string;
  priceId?: string;
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
}) {
  const {
    subscriptionId,
    priceId,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  } = params;

  const updateData: Record<string, unknown> = {
    status,
    cancelAtPeriodEnd,
    updatedAt: new Date(),
  };

  if (priceId !== undefined) {
    updateData.priceId = priceId;
  }
  if (currentPeriodStart !== undefined) {
    updateData.currentPeriodStart = currentPeriodStart;
  }
  if (currentPeriodEnd !== undefined) {
    updateData.currentPeriodEnd = currentPeriodEnd;
  }

  await testDb
    .update(subscription)
    .set(updateData)
    .where(eq(subscription.subscriptionId, subscriptionId));
}

/**
 * 处理订阅删除事件
 */
async function handleSubscriptionDeleted(subscriptionId: string) {
  await testDb
    .update(subscription)
    .set({
      status: "canceled",
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, subscriptionId));
}

/**
 * 构造积分购买 checkout.completed 事件
 */
function createCreditPurchaseCheckoutCompleted(params: {
  userId: string;
  credits: number;
  paymentId: string;
  packageId?: string;
}): CreemCheckoutCompletedData {
  const { userId, credits, paymentId, packageId } = params;
  return {
    id: `checkout_${paymentId}`,
    object: "checkout",
    order: {
      object: "order",
      id: `order_${paymentId}`,
      customer: `customer_${userId}`,
      product: `credits_${packageId ?? "custom"}`,
      amount: credits,
      currency: "USD",
      status: "paid",
      type: "onetime",
      transaction: paymentId,
    },
    customer: {
      id: `customer_${userId}`,
      email: `${userId}@example.com`,
    },
    status: "completed",
    metadata: {
      userId,
      type: "credit_purchase",
      credits: String(credits),
      ...(packageId ? { packageId } : {}),
    },
    mode: "test",
  };
}

/**
 * 构造订阅 checkout.completed 事件
 */
function createSubscriptionCheckoutCompleted(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
}): CreemCheckoutCompletedData {
  const { userId, subscriptionId, priceId } = params;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    id: `checkout_${subscriptionId}`,
    object: "checkout",
    order: {
      object: "order",
      id: `order_${subscriptionId}`,
      customer: `customer_${userId}`,
      product: priceId,
      amount: 9,
      currency: "USD",
      status: "paid",
      type: "subscription",
      transaction: `txn_${subscriptionId}`,
    },
    product: {
      id: priceId,
      name: "Pro Monthly",
      price: 9,
      currency: "USD",
      billing_type: "recurring",
      billing_period: "month",
    },
    subscription: {
      id: subscriptionId,
      status: "active",
      product: priceId,
      customer: `customer_${userId}`,
      current_period_start_date: now.toISOString(),
      current_period_end_date: periodEnd.toISOString(),
      cancel_at_period_end: false,
      metadata: {
        userId,
      },
    },
    customer: {
      id: `customer_${userId}`,
      email: `${userId}@example.com`,
    },
    status: "completed",
    metadata: {
      userId,
      planId: "pro",
    },
    mode: "test",
  };
}

/**
 * 构造订阅生命周期事件
 */
function createSubscriptionEvent(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
  periodStart: Date;
  periodEnd: Date;
  status?: CreemSubscription["status"];
}): CreemSubscription {
  const {
    userId,
    subscriptionId,
    priceId,
    periodStart,
    periodEnd,
    status = "active",
  } = params;

  return {
    id: subscriptionId,
    status,
    product: priceId,
    customer: `customer_${userId}`,
    current_period_start_date: periodStart.toISOString(),
    current_period_end_date: periodEnd.toISOString(),
    cancel_at_period_end: false,
    metadata: {
      userId,
    },
  };
}

// ============================================
// Checkout Session Completed 测试
// ============================================

describe("Creem Webhook: checkout.completed", () => {
  describe("Subscription Payment", () => {
    it("订阅 checkout.completed 应该写入统一订单", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      await handleCheckoutCompleted(
        createSubscriptionCheckoutCompleted({
          userId: testUser.id,
          subscriptionId: `sub_checkout_${Date.now()}`,
          priceId: proMonthlyPriceId,
        })
      );

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.order.orderType).toBe("subscription");
      expect(orders[0]!.items).toHaveLength(1);
      expect(orders[0]!.items[0]!.productType).toBe("subscription");
      expect(orders[0]!.items[0]!.priceId).toBe(proMonthlyPriceId);
    });

    it("应该为新用户创建订阅记录", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const now = new Date();
      const thirtyDaysLater = new Date(
        now.getTime() + 30 * 24 * 60 * 60 * 1000
      );

      await handleSubscriptionCreated({
        userId: testUser.id,
        subscriptionId: `sub_test_${Date.now()}`,
        priceId: proMonthlyPriceId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: thirtyDaysLater,
        cancelAtPeriodEnd: false,
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub).toBeDefined();
      expect(sub!.status).toBe("active");
      expect(sub!.priceId).toBe(proMonthlyPriceId);

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(0);
    });

    it("已有订阅的用户不应重复创建", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      // 先创建一个订阅
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: "sub_existing",
        priceId: "price_old",
        status: "active",
      });

      // 模拟 subscription.created 事件
      await handleSubscriptionCreated({
        userId: testUser.id,
        subscriptionId: "sub_new",
        priceId: "price_new",
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      });

      // 应该保持原有订阅
      const sub = await getUserSubscription(testUser.id);
      expect(sub!.subscriptionId).toBe("sub_existing");
      expect(sub!.priceId).toBe("price_old");
    });
  });

  describe("One-Time Payment (Lifetime)", () => {
    it("应该为新用户创建 Lifetime 订阅", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      await handleOneTimePaymentCompleted({
        userId: testUser.id,
        paymentIntentId: `pi_test_${Date.now()}`,
        planId: "lifetime_pro",
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub).toBeDefined();
      expect(sub!.status).toBe("lifetime");
      expect(sub!.priceId).toBe("lifetime_pro");
      expect(sub!.currentPeriodEnd).toBeNull();
      expect(sub!.subscriptionId).toContain("lifetime_");
    });

    it("应该将现有订阅升级为 Lifetime", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      // 先创建一个普通订阅
      await createTestSubscription({
        userId: testUser.id,
        status: "active",
        priceId: "price_monthly",
      });

      // 购买 Lifetime
      await handleOneTimePaymentCompleted({
        userId: testUser.id,
        paymentIntentId: `pi_upgrade_${Date.now()}`,
        planId: "lifetime",
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub!.status).toBe("lifetime");
      expect(sub!.currentPeriodEnd).toBeNull();
    });
  });

  describe("Credit Purchase", () => {
    it("应该发放购买的积分", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      await handleCheckoutCompleted(
        createCreditPurchaseCheckoutCompleted({
          userId: testUser.id,
          credits: 500,
          paymentId: `cs_test_${Date.now()}`,
          packageId: "standard",
        })
      );

      const state = await getUserCreditsState(testUser.id);
      expect(state.balance!.balance).toBe(500);
      expect(state.transactions).toHaveLength(1);
      expect(state.transactions[0]?.amount).toBe(500);

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.order.orderType).toBe("credit_purchase");
      expect(orders[0]!.items).toHaveLength(1);
      expect(orders[0]!.items[0]!.productType).toBe("credit_package");
    });

    it("应该正确设置积分过期时间", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      await handleCheckoutCompleted(
        createCreditPurchaseCheckoutCompleted({
          userId: testUser.id,
          credits: 100,
          paymentId: `cs_expiry_${Date.now()}`,
        })
      );

      const state = await getUserCreditsState(testUser.id);
      const batch = state.batches[0];

      if (CREDITS_EXPIRY_DAYS === null) {
        expect(batch!.expiresAt).toBeNull();
        return;
      }

      expect(batch!.expiresAt).not.toBeNull();
    });

    it("应该累加已有积分", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      await handleCheckoutCompleted(
        createCreditPurchaseCheckoutCompleted({
          userId: testUser.id,
          credits: 200,
          paymentId: `cs_first_${Date.now()}`,
        })
      );

      await handleCheckoutCompleted(
        createCreditPurchaseCheckoutCompleted({
          userId: testUser.id,
          credits: 300,
          paymentId: `cs_second_${Date.now()}`,
        })
      );

      const state = await getUserCreditsState(testUser.id);
      expect(state.balance!.balance).toBe(500);
      expect(state.batches).toHaveLength(2);
    });

    it("重复的 checkout.completed 不应该重复发积分", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const event = createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 150,
        paymentId: `cs_dup_${Date.now()}`,
        packageId: "lite",
      });

      await handleCheckoutCompleted(event);
      await handleCheckoutCompleted(event);

      const state = await getUserCreditsState(testUser.id);
      expect(state.balance!.balance).toBe(150);
      expect(state.batches).toHaveLength(1);
      expect(state.transactions).toHaveLength(1);

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.items).toHaveLength(1);
    });

    it("重复的 checkout.completed 不应该改写已落单金额快照", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const paymentId = `cs_snapshot_${Date.now()}`;
      const firstEvent = createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 150,
        paymentId,
        packageId: "lite",
      });
      const secondEvent = {
        ...firstEvent,
        order: {
          ...firstEvent.order!,
          amount: 999,
        },
        product: {
          id: "credits_changed",
          name: "Changed",
          price: 999,
          currency: "USD",
          billing_type: "onetime" as const,
          billing_period: "custom",
        },
        metadata: {
          ...firstEvent.metadata!,
          credits: "999",
        },
      };

      await handleCheckoutCompleted(firstEvent);
      await handleCheckoutCompleted(secondEvent);

      const [orderRecord] = await getUserSalesOrders(testUser.id);
      expect(orderRecord!.order.grossAmount).toBe(150);
      expect(orderRecord!.items[0]!.grossAmount).toBe(150);
      expect(orderRecord!.items[0]!.productId).toBe("credits_lite");
    });

    it("应该把归因字段显式写入统一订单", async () => {
      const agentUser = await createTestUser();
      const buyerUser = await createTestUser();
      createdUserIds.push(agentUser.id, buyerUser.id);

      await createTestDistributionProfile({
        userId: agentUser.id,
        displayName: "Agent",
      });
      await createTestReferralCode({
        agentUserId: agentUser.id,
        code: "agent-pro",
        campaign: "spring",
        landingPath: "/pricing",
      });

      const attributionId = `attr_${Date.now()}`;
      await testDb.insert(distributionAttribution).values({
        id: attributionId,
        visitorKey: "visitor_test",
        userId: buyerUser.id,
        agentUserId: agentUser.id,
        referralCode: "agent-pro",
        campaign: "spring",
        landingPath: "/pricing",
        source: "referral_link",
        boundReason: "checkout",
        boundAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        snapshot: {
          referralCode: "agent-pro",
          agentUserId: agentUser.id,
          campaign: "spring",
        },
      });

      await handleCheckoutCompleted({
        ...createCreditPurchaseCheckoutCompleted({
          userId: buyerUser.id,
          credits: 120,
          paymentId: `cs_attr_${Date.now()}`,
          packageId: "starter",
        }),
        metadata: {
          userId: buyerUser.id,
          type: "credit_purchase",
          credits: "120",
          packageId: "starter",
          referralCode: "agent-pro",
          attributedAgentUserId: agentUser.id,
          attributionId,
          campaign: "spring",
          landingPath: "/pricing",
          visitorKey: "visitor_test",
        },
      });

      const orders = await getUserSalesOrders(buyerUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.order.referralCode).toBe("agent-pro");
      expect(orders[0]!.order.attributedAgentUserId).toBe(agentUser.id);
      expect(orders[0]!.order.attributionId).toBe(attributionId);
      expect(orders[0]!.order.attributionSnapshot).toMatchObject({
        referralCode: "agent-pro",
        agentUserId: agentUser.id,
        campaign: "spring",
      });
    });
  });
});

// ============================================
// Subscription Lifecycle 测试
// ============================================

describe("Creem Webhook: subscription lifecycle", () => {
  describe("统一订单落单", () => {
    it("subscription.active 应该确认首购 checkout 订单", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_active_${Date.now()}`;
      await handleCheckoutCompleted(
        createSubscriptionCheckoutCompleted({
          userId: testUser.id,
          subscriptionId,
          priceId: proMonthlyPriceId,
        })
      );

      const ordersBeforeActive = await getUserSalesOrders(testUser.id);
      expect(ordersBeforeActive).toHaveLength(1);
      expect(ordersBeforeActive[0]!.order.status).toBe("paid");
      expect(ordersBeforeActive[0]!.order.eventType).toBe("checkout.completed");

      const periodStart = new Date();
      const periodEnd = new Date(
        periodStart.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      await handleSubscriptionActive(
        createSubscriptionEvent({
          userId: testUser.id,
          subscriptionId,
          priceId: proMonthlyPriceId,
          periodStart,
          periodEnd,
        })
      );

      const ordersAfterActive = await getUserSalesOrders(testUser.id);
      expect(ordersAfterActive).toHaveLength(1);
      expect(ordersAfterActive[0]!.order.status).toBe("confirmed");
      expect(ordersAfterActive[0]!.order.eventType).toBe("subscription.active");
      expect(ordersAfterActive[0]!.items).toHaveLength(1);
    });

    it("重复的 subscription.active 不应该重复创建首购订单", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_active_dup_${Date.now()}`;
      const checkoutEvent = createSubscriptionCheckoutCompleted({
        userId: testUser.id,
        subscriptionId,
        priceId: proMonthlyPriceId,
      });
      const activeStart = new Date();
      const activeEnd = new Date(
        activeStart.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      const activeEvent = createSubscriptionEvent({
        userId: testUser.id,
        subscriptionId,
        priceId: proMonthlyPriceId,
        periodStart: activeStart,
        periodEnd: activeEnd,
      });

      await handleCheckoutCompleted(checkoutEvent);
      await handleSubscriptionActive(activeEvent);
      await handleSubscriptionActive(activeEvent);

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.order.eventType).toBe("subscription.active");
      expect(orders[0]!.items[0]!.priceId).toBe(proMonthlyPriceId);
    });

    it("subscription.renewed 应该生成新的续费订单", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_renew_${Date.now()}`;
      const firstStart = new Date();
      const firstEnd = new Date(
        firstStart.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId,
        priceId: proMonthlyPriceId,
        status: "active",
        currentPeriodStart: firstStart,
        currentPeriodEnd: firstEnd,
      });

      await handleSubscriptionRenewed(
        createSubscriptionEvent({
          userId: testUser.id,
          subscriptionId,
          priceId: proMonthlyPriceId,
          periodStart: new Date(firstEnd.getTime()),
          periodEnd: new Date(firstEnd.getTime() + 30 * 24 * 60 * 60 * 1000),
        })
      );

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.order.status).toBe("paid");
      expect(orders[0]!.order.eventType).toBe("subscription.renewed");
      expect(orders[0]!.order.providerSubscriptionId).toBe(subscriptionId);
      expect(orders[0]!.items).toHaveLength(1);
      expect(orders[0]!.items[0]!.productType).toBe("subscription");
    });

    it("重复的 subscription.renewed 不应该重复创建续费订单", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_renew_dup_${Date.now()}`;
      const firstStart = new Date();
      const firstEnd = new Date(
        firstStart.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      const renewalStart = new Date(firstEnd.getTime());
      const renewalEnd = new Date(
        firstEnd.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId,
        priceId: proMonthlyPriceId,
        status: "active",
        currentPeriodStart: firstStart,
        currentPeriodEnd: firstEnd,
      });

      const renewalEvent = createSubscriptionEvent({
        userId: testUser.id,
        subscriptionId,
        priceId: proMonthlyPriceId,
        periodStart: renewalStart,
        periodEnd: renewalEnd,
      });

      await handleSubscriptionRenewed(renewalEvent);
      await handleSubscriptionRenewed(renewalEvent);

      const orders = await getUserSalesOrders(testUser.id);
      expect(orders).toHaveLength(1);
      expect(orders[0]!.items).toHaveLength(1);
    });

    it("订单项写入失败时不应该留下半成订单", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const seedOrderId = `seed_order_${Date.now()}`;
      const duplicateItemId = `dup_order_item_${Date.now()}`;
      const rollbackOrderId = `rollback_order_${Date.now()}`;

      await testDb.insert(salesOrder).values({
        id: seedOrderId,
        userId: testUser.id,
        provider: "creem",
        orderType: "credit_purchase",
        status: "paid",
        afterSalesStatus: "none",
        currency: "USD",
        grossAmount: 1,
        eventTime: new Date(),
        eventType: "seed",
        eventIdempotencyKey: `seed:${Date.now()}`,
      });
      await testDb.insert(salesOrderItem).values({
        id: duplicateItemId,
        orderId: seedOrderId,
        productType: "credit_package",
        productId: "seed",
        priceId: "seed",
        quantity: 1,
        grossAmount: 1,
        netAmount: 1,
        commissionBaseAmount: 1,
        refundedAmount: 0,
        refundableAmount: 1,
      });

      const uuidSpy = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValueOnce(rollbackOrderId)
        .mockReturnValueOnce(duplicateItemId);

      await expect(
        handleCheckoutCompleted(
          createCreditPurchaseCheckoutCompleted({
            userId: testUser.id,
            credits: 50,
            paymentId: `tx_rollback_${Date.now()}`,
            packageId: "rollback",
          })
        )
      ).rejects.toThrow();

      uuidSpy.mockRestore();

      const [order] = await testDb
        .select()
        .from(salesOrder)
        .where(eq(salesOrder.id, rollbackOrderId))
        .limit(1);

      expect(order).toBeUndefined();
    });
  });

  describe("subscription.updated", () => {
    it("应该更新订阅状态", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_update_${Date.now()}`;
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: subscriptionId,
        status: "trialing",
      });

      // 模拟试用期结束，转为 active
      await handleSubscriptionUpdated({
        subscriptionId,
        status: "active",
        cancelAtPeriodEnd: false,
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub!.status).toBe("active");
    });

    it("应该更新订阅周期", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_period_${Date.now()}`;
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: subscriptionId,
        status: "active",
      });

      const newPeriodStart = new Date();
      const newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await handleSubscriptionUpdated({
        subscriptionId,
        status: "active",
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        cancelAtPeriodEnd: false,
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub!.currentPeriodEnd!.getTime()).toBe(newPeriodEnd.getTime());
    });

    it("应该标记订阅为周期结束后取消", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_cancel_end_${Date.now()}`;
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: subscriptionId,
        status: "active",
        cancelAtPeriodEnd: false,
      });

      await handleSubscriptionUpdated({
        subscriptionId,
        status: "active",
        cancelAtPeriodEnd: true,
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub!.cancelAtPeriodEnd).toBe(true);
    });

    it("应该更新订阅计划（升级/降级）", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_upgrade_${Date.now()}`;
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: subscriptionId,
        priceId: "price_basic_monthly",
        status: "active",
      });

      // 升级到 Pro
      await handleSubscriptionUpdated({
        subscriptionId,
        priceId: "price_pro_monthly",
        status: "active",
        cancelAtPeriodEnd: false,
      });

      const sub = await getUserSubscription(testUser.id);
      expect(sub!.priceId).toBe("price_pro_monthly");
    });
  });

  describe("subscription.deleted", () => {
    it("应该将订阅状态标记为 canceled", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_delete_${Date.now()}`;
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: subscriptionId,
        status: "active",
      });

      await handleSubscriptionDeleted(subscriptionId);

      const sub = await getUserSubscription(testUser.id);
      expect(sub!.status).toBe("canceled");
    });

    it("应该保留订阅记录（不删除）", async () => {
      const testUser = await createTestUser();
      createdUserIds.push(testUser.id);

      const subscriptionId = `sub_keep_${Date.now()}`;
      await createTestSubscription({
        userId: testUser.id,
        subscriptionId: subscriptionId,
        status: "active",
      });

      await handleSubscriptionDeleted(subscriptionId);

      // 记录应该仍然存在
      const sub = await getUserSubscription(testUser.id);
      expect(sub).toBeDefined();
      expect(sub!.subscriptionId).toBe(subscriptionId);
    });
  });
});

// ============================================
// 边界情况测试
// ============================================

describe("Creem Webhook: Edge Cases", () => {
  it("不存在的订阅 ID 更新应该静默失败", async () => {
    // 不应该抛出错误
    await expect(
      handleSubscriptionUpdated({
        subscriptionId: "sub_nonexistent_12345",
        status: "active",
        cancelAtPeriodEnd: false,
      })
    ).resolves.not.toThrow();
  });

  it("不存在的订阅 ID 删除应该静默失败", async () => {
    await expect(
      handleSubscriptionDeleted("sub_nonexistent_67890")
    ).resolves.not.toThrow();
  });

  it("积分购买金额为 0 应该失败", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    await handleCheckoutCompleted(
      createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 0,
        paymentId: `cs_zero_${Date.now()}`,
      })
    );

    const state = await getUserCreditsState(testUser.id);
    expect(state.balance).toBeUndefined();
    expect(state.batches).toHaveLength(0);
  });

  it("积分购买金额为负数应该失败", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    await handleCheckoutCompleted(
      createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: -100,
        paymentId: `cs_negative_${Date.now()}`,
      })
    );

    const state = await getUserCreditsState(testUser.id);
    expect(state.balance).toBeUndefined();
    expect(state.batches).toHaveLength(0);
  });
});

describe("Creem Webhook: after sales", () => {
  it("部分退款应该回写订单和订单项", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    await handleCheckoutCompleted(
      createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 200,
        paymentId: `cs_partial_${Date.now()}`,
        packageId: "standard",
      })
    );

    const [orderRecord] = await getUserSalesOrders(testUser.id);
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "partial_refund",
      eventIdempotencyKey: `refund_partial_${Date.now()}`,
      amount: 50,
      currency: "USD",
      reason: "manual_partial_refund",
    });

    const [updatedOrder] = await getUserSalesOrders(testUser.id);
    expect(updatedOrder!.order.afterSalesStatus).toBe("partial_refund");
    expect(updatedOrder!.order.status).toBe("paid");
    expect(updatedOrder!.items[0]!.refundedAmount).toBe(50);
    expect(updatedOrder!.items[0]!.refundableAmount).toBe(150);
  });

  it("超出可退金额的售后事件应该拒绝写入", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    await handleCheckoutCompleted(
      createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 120,
        paymentId: `cs_refund_guard_${Date.now()}`,
        packageId: "starter",
      })
    );

    const [orderRecord] = await getUserSalesOrders(testUser.id);
    await expect(
      applySalesAfterSalesEvent({
        orderId: orderRecord!.order.id,
        orderItemId: orderRecord!.items[0]!.id,
        eventType: "refunded",
        eventIdempotencyKey: `refund_guard_${Date.now()}`,
        amount: 121,
        currency: "USD",
        reason: "over_refund",
      })
    ).rejects.toThrow("After-sales amount exceeds refundable amount");

    const events = await testDb
      .select()
      .from(salesAfterSalesEvent)
      .where(eq(salesAfterSalesEvent.orderId, orderRecord!.order.id));
    const [unchangedOrder] = await getUserSalesOrders(testUser.id);
    expect(events).toHaveLength(0);
    expect(unchangedOrder!.order.afterSalesStatus).toBe("none");
    expect(unchangedOrder!.items[0]!.refundedAmount).toBe(0);
  });

  it("全额退款应该关闭订单", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    await handleCheckoutCompleted(
      createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 180,
        paymentId: `cs_refund_${Date.now()}`,
        packageId: "standard",
      })
    );

    const [orderRecord] = await getUserSalesOrders(testUser.id);
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "refunded",
      eventIdempotencyKey: `refund_full_${Date.now()}`,
      amount: 180,
      currency: "USD",
      reason: "manual_refund",
    });

    const [updatedOrder] = await getUserSalesOrders(testUser.id);
    expect(updatedOrder!.order.afterSalesStatus).toBe("refunded");
    expect(updatedOrder!.order.status).toBe("closed");
    expect(updatedOrder!.items[0]!.refundedAmount).toBe(180);
    expect(updatedOrder!.items[0]!.refundableAmount).toBe(0);
  });

  it("重复的拒付事件不应该重复回写", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    await handleCheckoutCompleted(
      createCreditPurchaseCheckoutCompleted({
        userId: testUser.id,
        credits: 160,
        paymentId: `cs_chargeback_${Date.now()}`,
        packageId: "lite",
      })
    );

    const [orderRecord] = await getUserSalesOrders(testUser.id);
    const eventIdempotencyKey = `chargeback_${Date.now()}`;
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "chargeback",
      eventIdempotencyKey,
      amount: 160,
      currency: "USD",
      reason: "provider_chargeback",
    });
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "chargeback",
      eventIdempotencyKey,
      amount: 160,
      currency: "USD",
      reason: "provider_chargeback",
    });

    const [updatedOrder] = await getUserSalesOrders(testUser.id);
    const afterSalesEvents = await testDb
      .select()
      .from(salesAfterSalesEvent)
      .where(eq(salesAfterSalesEvent.orderId, orderRecord!.order.id));

    expect(updatedOrder!.order.afterSalesStatus).toBe("chargeback");
    expect(updatedOrder!.order.status).toBe("closed");
    expect(updatedOrder!.items[0]!.refundedAmount).toBe(160);
    expect(afterSalesEvents).toHaveLength(1);
  });
});

describe("Creem Webhook: commission", () => {
  it("有归因的积分订单应该生成冻结佣金", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    await createTestDistributionProfile({
      userId: agentUser.id,
      displayName: "Agent",
    });
    await createTestReferralCode({
      agentUserId: agentUser.id,
      code: "agent-commission",
      campaign: "launch",
      landingPath: "/pricing",
    });

    const ruleId = `rule_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 7,
      appliesToCreditPackage: true,
      priority: 10,
    });

    const attributionId = `attr_commission_${Date.now()}`;
    await testDb.insert(distributionAttribution).values({
      id: attributionId,
      visitorKey: "visitor_commission",
      userId: buyerUser.id,
      agentUserId: agentUser.id,
      referralCode: "agent-commission",
      campaign: "launch",
      landingPath: "/pricing",
      source: "referral_link",
      boundReason: "checkout",
      boundAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      snapshot: {
        referralCode: "agent-commission",
        agentUserId: agentUser.id,
      },
    });

    await handleCheckoutCompleted({
      ...createCreditPurchaseCheckoutCompleted({
        userId: buyerUser.id,
        credits: 200,
        paymentId: `cs_commission_${Date.now()}`,
        packageId: "standard",
      }),
      metadata: {
        userId: buyerUser.id,
        type: "credit_purchase",
        credits: "200",
        packageId: "standard",
        referralCode: "agent-commission",
        attributedAgentUserId: agentUser.id,
        attributionId,
        campaign: "launch",
        landingPath: "/pricing",
        visitorKey: "visitor_commission",
      },
    });

    const commissionEvents = await testDb
      .select()
      .from(commissionEvent)
      .where(eq(commissionEvent.triggerUserId, buyerUser.id));
    const commissionRecords = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.beneficiaryUserId, agentUser.id));
    const commissionBalances = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id));
    const commissionLedgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, agentUser.id));

    expect(commissionEvents).toHaveLength(1);
    expect(commissionEvents[0]!.status).toBe("completed");
    expect(commissionRecords).toHaveLength(1);
    expect(commissionRecords[0]!.amount).toBe(20);
    expect(commissionRecords[0]!.status).toBe("frozen");
    expect(commissionBalances).toHaveLength(1);
    expect(commissionBalances[0]!.frozenAmount).toBe(20);
    expect(commissionBalances[0]!.totalEarned).toBe(20);
    expect(commissionLedgers).toHaveLength(1);
    expect(commissionLedgers[0]!.entryType).toBe("commission_frozen");
  });

  it("重复的积分订单 webhook 不应该重复记佣金", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const ruleId = `rule_dup_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 7,
      appliesToCreditPackage: true,
      priority: 10,
    });

    const event = {
      ...createCreditPurchaseCheckoutCompleted({
        userId: buyerUser.id,
        credits: 150,
        paymentId: `cs_commission_dup_${Date.now()}`,
        packageId: "lite",
      }),
      metadata: {
        userId: buyerUser.id,
        type: "credit_purchase",
        credits: "150",
        packageId: "lite",
        referralCode: "dup-commission",
        attributedAgentUserId: agentUser.id,
      },
    };

    await handleCheckoutCompleted(event);
    await handleCheckoutCompleted(event);

    const commissionEvents = await testDb
      .select()
      .from(commissionEvent)
      .where(eq(commissionEvent.triggerUserId, buyerUser.id));
    const commissionRecords = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.beneficiaryUserId, agentUser.id));
    const [commissionBalanceRow] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);

    expect(commissionEvents).toHaveLength(1);
    expect(commissionRecords).toHaveLength(1);
    expect(commissionBalanceRow!.frozenAmount).toBe(15);
  });

  it("部分退款后应该回冲对应比例的冻结佣金", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const ruleId = `rule_reverse_partial_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 7,
      appliesToCreditPackage: true,
      priority: 10,
    });

    await handleCheckoutCompleted({
      ...createCreditPurchaseCheckoutCompleted({
        userId: buyerUser.id,
        credits: 200,
        paymentId: `cs_reverse_partial_${Date.now()}`,
        packageId: "standard",
      }),
      metadata: {
        userId: buyerUser.id,
        type: "credit_purchase",
        credits: "200",
        packageId: "standard",
        referralCode: "reverse-partial",
        attributedAgentUserId: agentUser.id,
      },
    });

    const [orderRecord] = await getUserSalesOrders(buyerUser.id);
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "partial_refund",
      eventIdempotencyKey: `commission_partial_refund_${Date.now()}`,
      amount: 50,
      currency: "USD",
      reason: "partial_refund_review",
    });

    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);
    const [record] = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.beneficiaryUserId, agentUser.id))
      .limit(1);
    const reverseLedgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, agentUser.id));

    expect(balance!.frozenAmount).toBe(15);
    expect(balance!.reversedAmount).toBe(5);
    expect(record!.status).toBe("frozen");
    expect(
      reverseLedgers.filter((entry) => entry.entryType === "commission_reverse")
    ).toHaveLength(1);
  });

  it("全额退款后应该把冻结佣金全部冲回", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const ruleId = `rule_reverse_full_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 7,
      appliesToCreditPackage: true,
      priority: 10,
    });

    await handleCheckoutCompleted({
      ...createCreditPurchaseCheckoutCompleted({
        userId: buyerUser.id,
        credits: 200,
        paymentId: `cs_reverse_full_${Date.now()}`,
        packageId: "standard",
      }),
      metadata: {
        userId: buyerUser.id,
        type: "credit_purchase",
        credits: "200",
        packageId: "standard",
        referralCode: "reverse-full",
        attributedAgentUserId: agentUser.id,
      },
    });

    const [orderRecord] = await getUserSalesOrders(buyerUser.id);
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "refunded",
      eventIdempotencyKey: `commission_full_refund_${Date.now()}`,
      amount: 200,
      currency: "USD",
      reason: "full_refund_review",
    });

    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);
    const [record] = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.beneficiaryUserId, agentUser.id))
      .limit(1);

    expect(balance!.frozenAmount).toBe(0);
    expect(balance!.reversedAmount).toBe(20);
    expect(record!.status).toBe("reversed");
  });

  it("冻结佣金到期后应该转为可用余额", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const ruleId = `rule_release_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 0,
      appliesToCreditPackage: true,
      priority: 10,
    });

    await handleCheckoutCompleted({
      ...createCreditPurchaseCheckoutCompleted({
        userId: buyerUser.id,
        credits: 200,
        paymentId: `cs_release_${Date.now()}`,
        packageId: "standard",
      }),
      metadata: {
        userId: buyerUser.id,
        type: "credit_purchase",
        credits: "200",
        packageId: "standard",
        referralCode: "release-commission",
        attributedAgentUserId: agentUser.id,
      },
    });

    await releaseAvailableCommissionRecords(new Date(Date.now() + 1000));

    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);
    const [record] = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.beneficiaryUserId, agentUser.id))
      .limit(1);
    const availableLedgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, agentUser.id));

    expect(balance!.frozenAmount).toBe(0);
    expect(balance!.availableAmount).toBe(20);
    expect(record!.status).toBe("available");
    expect(
      availableLedgers.filter(
        (entry) => entry.entryType === "commission_available"
      )
    ).toHaveLength(1);
  });

  it("可用佣金在退款后应该扣减可用余额", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const ruleId = `rule_release_refund_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 0,
      appliesToCreditPackage: true,
      priority: 10,
    });

    await handleCheckoutCompleted({
      ...createCreditPurchaseCheckoutCompleted({
        userId: buyerUser.id,
        credits: 200,
        paymentId: `cs_release_refund_${Date.now()}`,
        packageId: "standard",
      }),
      metadata: {
        userId: buyerUser.id,
        type: "credit_purchase",
        credits: "200",
        packageId: "standard",
        referralCode: "release-refund",
        attributedAgentUserId: agentUser.id,
      },
    });

    await releaseAvailableCommissionRecords(new Date(Date.now() + 1000));

    const [orderRecord] = await getUserSalesOrders(buyerUser.id);
    await applySalesAfterSalesEvent({
      orderId: orderRecord!.order.id,
      orderItemId: orderRecord!.items[0]!.id,
      eventType: "refunded",
      eventIdempotencyKey: `commission_available_refund_${Date.now()}`,
      amount: 200,
      currency: "USD",
      reason: "available_refund_review",
    });

    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);
    const [record] = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.beneficiaryUserId, agentUser.id))
      .limit(1);
    const reverseLedgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, agentUser.id));

    expect(balance!.availableAmount).toBe(0);
    expect(balance!.frozenAmount).toBe(0);
    expect(balance!.reversedAmount).toBe(20);
    expect(record!.status).toBe("reversed");
    expect(
      reverseLedgers.filter((entry) => entry.entryType === "commission_reverse")
    ).toHaveLength(1);
  });

  it("佣金账本写入失败时不应该留下半成佣金记录", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const orderId = `commission_tx_order_${Date.now()}`;
    const orderItemId = `commission_tx_item_${Date.now()}`;
    const ruleId = `commission_tx_rule_${Date.now()}`;
    const duplicateLedgerId = `commission_tx_ledger_${Date.now()}`;
    const eventId = `commission_tx_event_${Date.now()}`;
    const recordId = `commission_tx_record_${Date.now()}`;
    createdCommissionRuleIds.push(ruleId);

    await testDb.insert(salesOrder).values({
      id: orderId,
      userId: buyerUser.id,
      provider: "creem",
      orderType: "credit_purchase",
      status: "paid",
      afterSalesStatus: "none",
      currency: "USD",
      grossAmount: 100,
      eventTime: new Date(),
      eventType: "checkout.completed",
      eventIdempotencyKey: `commission_tx_order:${Date.now()}`,
      attributedAgentUserId: agentUser.id,
    });
    await testDb.insert(salesOrderItem).values({
      id: orderItemId,
      orderId,
      productType: "credit_package",
      productId: "pkg",
      priceId: "pkg",
      quantity: 1,
      grossAmount: 100,
      netAmount: 100,
      commissionBaseAmount: 100,
      refundedAmount: 0,
      refundableAmount: 100,
    });
    await testDb.insert(commissionRule).values({
      id: ruleId,
      status: "active",
      orderType: "credit_purchase",
      productType: "credit_package",
      commissionLevel: 1,
      calculationMode: "rate",
      rate: 10,
      freezeDays: 7,
      appliesToCreditPackage: true,
      priority: 10,
    });
    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: agentUser.id,
      currency: "USD",
      totalEarned: 0,
      availableAmount: 0,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });
    await testDb.insert(commissionLedger).values({
      id: duplicateLedgerId,
      userId: agentUser.id,
      entryType: "commission_frozen",
      direction: "credit",
      amount: 1,
      beforeBalance: 0,
      afterBalance: 1,
      referenceType: "seed",
      referenceId: "seed",
      memo: "seed",
    });

    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(eventId)
      .mockReturnValueOnce(recordId)
      .mockReturnValueOnce(duplicateLedgerId);

    await expect(
      settleCommissionForSalesOrder(orderId, "credit_purchase")
    ).rejects.toThrow();

    uuidSpy.mockRestore();

    const [event] = await testDb
      .select()
      .from(commissionEvent)
      .where(eq(commissionEvent.id, eventId))
      .limit(1);
    const [record] = await testDb
      .select()
      .from(commissionRecord)
      .where(eq(commissionRecord.id, recordId))
      .limit(1);
    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);

    expect(event).toBeUndefined();
    expect(record).toBeUndefined();
    expect(balance!.frozenAmount).toBe(0);
    expect(balance!.totalEarned).toBe(0);
  });

  it("售后冲正写账失败时不应该留下半成售后状态", async () => {
    const agentUser = await createTestUser();
    const buyerUser = await createTestUser();
    createdUserIds.push(agentUser.id, buyerUser.id);

    const orderId = `after_sales_tx_order_${Date.now()}`;
    const orderItemId = `after_sales_tx_item_${Date.now()}`;
    const afterSalesEventId = `after_sales_tx_event_${Date.now()}`;
    const duplicateLedgerId = `after_sales_tx_ledger_${Date.now()}`;
    const commissionEventId = `after_sales_tx_commission_event_${Date.now()}`;
    const commissionRecordId = `after_sales_tx_commission_record_${Date.now()}`;

    await testDb.insert(salesOrder).values({
      id: orderId,
      userId: buyerUser.id,
      provider: "creem",
      orderType: "credit_purchase",
      status: "paid",
      afterSalesStatus: "none",
      currency: "USD",
      grossAmount: 100,
      eventTime: new Date(),
      eventType: "checkout.completed",
      eventIdempotencyKey: `after_sales_tx_order:${Date.now()}`,
      attributedAgentUserId: agentUser.id,
    });
    await testDb.insert(salesOrderItem).values({
      id: orderItemId,
      orderId,
      productType: "credit_package",
      productId: "pkg",
      priceId: "pkg",
      quantity: 1,
      grossAmount: 100,
      netAmount: 100,
      commissionBaseAmount: 100,
      refundedAmount: 0,
      refundableAmount: 100,
    });
    await testDb.insert(commissionEvent).values({
      id: commissionEventId,
      orderId,
      orderItemId,
      triggerUserId: buyerUser.id,
      triggerType: "credit_purchase",
      status: "completed",
      currency: "USD",
      commissionBaseAmount: 100,
      settlementBasis: "level_1",
      executedAt: new Date(),
    });
    await testDb.insert(commissionRecord).values({
      id: commissionRecordId,
      eventId: commissionEventId,
      beneficiaryUserId: agentUser.id,
      sourceAgentUserId: agentUser.id,
      commissionLevel: 1,
      amount: 10,
      currency: "USD",
      status: "available",
      availableAt: new Date(),
      metadata: {
        orderId,
        orderItemId,
      },
    });
    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: agentUser.id,
      currency: "USD",
      totalEarned: 10,
      availableAmount: 10,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });
    await testDb.insert(commissionLedger).values({
      id: duplicateLedgerId,
      userId: agentUser.id,
      recordId: commissionRecordId,
      entryType: "commission_reverse",
      direction: "debit",
      amount: 1,
      beforeBalance: 10,
      afterBalance: 9,
      referenceType: "seed",
      referenceId: "seed",
      memo: "seed",
    });

    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(afterSalesEventId)
      .mockReturnValueOnce(duplicateLedgerId);

    await expect(
      applySalesAfterSalesEvent({
        orderId,
        orderItemId,
        eventType: "partial_refund",
        eventIdempotencyKey: `after_sales_tx_idempotent_${Date.now()}`,
        amount: 100,
        currency: "USD",
        reason: "tx_rollback",
      })
    ).rejects.toThrow();

    uuidSpy.mockRestore();

    const [afterSalesEvent] = await testDb
      .select()
      .from(salesAfterSalesEvent)
      .where(eq(salesAfterSalesEvent.id, afterSalesEventId))
      .limit(1);
    const [order] = await testDb
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.id, orderId))
      .limit(1);
    const [item] = await testDb
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.id, orderItemId))
      .limit(1);
    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, agentUser.id))
      .limit(1);

    expect(afterSalesEvent).toBeUndefined();
    expect(order!.status).toBe("paid");
    expect(order!.afterSalesStatus).toBe("none");
    expect(item!.refundedAmount).toBe(0);
    expect(item!.refundableAmount).toBe(100);
    expect(balance!.availableAmount).toBe(10);
    expect(balance!.reversedAmount).toBe(0);
  });
});

// ============================================
// 完整流程测试
// ============================================

describe("Creem Webhook: Full Lifecycle", () => {
  it("完整订阅生命周期：创建 → 续费 → 取消 → 删除", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    const subscriptionId = `sub_lifecycle_${Date.now()}`;
    const now = new Date();

    // 1. 创建订阅
    await handleSubscriptionCreated({
      userId: testUser.id,
      subscriptionId,
      priceId: "price_monthly",
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    });

    let sub = await getUserSubscription(testUser.id);
    expect(sub!.status).toBe("active");

    // 2. 续费（更新周期）
    const newPeriodEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    await handleSubscriptionUpdated({
      subscriptionId,
      status: "active",
      currentPeriodEnd: newPeriodEnd,
      cancelAtPeriodEnd: false,
    });

    sub = await getUserSubscription(testUser.id);
    expect(sub!.currentPeriodEnd!.getTime()).toBe(newPeriodEnd.getTime());

    // 3. 用户请求取消（周期结束后取消）
    await handleSubscriptionUpdated({
      subscriptionId,
      status: "active",
      cancelAtPeriodEnd: true,
    });

    sub = await getUserSubscription(testUser.id);
    expect(sub!.cancelAtPeriodEnd).toBe(true);
    expect(sub!.status).toBe("active"); // 仍然活跃直到周期结束

    // 4. 周期结束，订阅被删除
    await handleSubscriptionDeleted(subscriptionId);

    sub = await getUserSubscription(testUser.id);
    expect(sub!.status).toBe("canceled");
  });

  it("从订阅升级到 Lifetime", async () => {
    const testUser = await createTestUser();
    createdUserIds.push(testUser.id);

    const subscriptionId = `sub_to_lifetime_${Date.now()}`;

    // 1. 开始订阅
    await handleSubscriptionCreated({
      userId: testUser.id,
      subscriptionId,
      priceId: "price_monthly",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    });

    let sub = await getUserSubscription(testUser.id);
    expect(sub!.status).toBe("active");

    // 2. 购买 Lifetime（覆盖订阅）
    await handleOneTimePaymentCompleted({
      userId: testUser.id,
      paymentIntentId: `pi_lifetime_${Date.now()}`,
      planId: "lifetime",
    });

    sub = await getUserSubscription(testUser.id);
    expect(sub!.status).toBe("lifetime");
    expect(sub!.currentPeriodEnd).toBeNull();
  });
});
