import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  account,
  commissionBalance,
  commissionEvent,
  commissionLedger,
  commissionRecord,
  commissionRule,
  creditsBalance,
  creditsBatch,
  creditsTransaction,
  distributionAttribution,
  distributionProfile,
  distributionReferralCode,
  salesAfterSalesEvent,
  salesOrder,
  salesOrderItem,
  session,
  subscription,
  user,
  type UserRole,
  withdrawalRequest,
} from "@/db/schema";
import type {
  CheckoutAttributionContext,
} from "@/features/distribution/attribution";
import type {
  CreemCheckoutCompletedData,
  CreemSubscription,
} from "@/features/payment/creem";

const runDemo = process.env.RUN_DISTRIBUTION_DEMO === "1";
const describeIfDemo = runDemo ? describe : describe.skip;

const demoPassword = "DemoPass123!";
const demoUsers = {
  admin: {
    email: "dist-demo-admin@example.com",
    name: "Distribution Demo Admin",
    role: "admin" as const,
  },
  alpha: {
    email: "dist-demo-agent-alpha@example.com",
    name: "Agent Alpha",
    role: "user" as const,
  },
  beta: {
    email: "dist-demo-agent-beta@example.com",
    name: "Agent Beta",
    role: "user" as const,
  },
  gamma: {
    email: "dist-demo-agent-gamma@example.com",
    name: "Agent Gamma",
    role: "user" as const,
  },
  buyers: [
    "dist-demo-buyer-01@example.com",
    "dist-demo-buyer-02@example.com",
    "dist-demo-buyer-03@example.com",
    "dist-demo-buyer-04@example.com",
    "dist-demo-buyer-05@example.com",
    "dist-demo-buyer-06@example.com",
    "dist-demo-buyer-07@example.com",
    "dist-demo-buyer-08@example.com",
    "dist-demo-buyer-09@example.com",
  ],
} as const;

const demoRuleIds = {
  credit: "demo_dist_rule_credit_v1",
  subscription: "demo_dist_rule_subscription_v1",
} as const;
const demoCurrency = "CNY";

type DemoDistributionReferralCode = typeof distributionReferralCode.$inferSelect;

/**
 * 生成唯一的演示记录 ID
 */
function demoId(prefix: string) {
  return `demo_dist_${prefix}_${crypto.randomUUID()}`;
}

/**
 * 创建演示账号并补邮箱密码凭证
 */
async function createDemoUser(params: {
  email: string;
  name: string;
  role?: UserRole;
}) {
  const userId = demoId("user");
  const passwordHash = await hashPassword(demoPassword);
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    email: params.email,
    name: params.name,
    emailVerified: true,
    role: params.role ?? "user",
    banned: false,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(account).values({
    id: demoId("account"),
    userId,
    providerId: "credential",
    accountId: userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  return userId;
}

/**
 * 创建演示代理资料
 */
async function createDemoAgentProfile(params: {
  userId: string;
  displayName: string;
  agentLevel: string;
  depth: number;
  path: string;
  inviterUserId?: string;
  status?: "active" | "inactive";
}) {
  await db.insert(distributionProfile).values({
    id: demoId("profile"),
    userId: params.userId,
    displayName: params.displayName,
    agentLevel: params.agentLevel,
    depth: params.depth,
    path: params.path,
    inviterUserId: params.inviterUserId ?? null,
    status: params.status ?? "active",
    boundAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * 创建演示推广码
 */
async function createDemoReferralCode(params: {
  agentUserId: string;
  code: string;
  campaign?: string;
  landingPath?: string;
  status?: "active" | "inactive";
}) {
  const [code] = await db
    .insert(distributionReferralCode)
    .values({
      id: demoId("ref"),
      agentUserId: params.agentUserId,
      code: params.code,
      campaign: params.campaign ?? null,
      landingPath: params.landingPath ?? null,
      status: params.status ?? "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return code as DemoDistributionReferralCode;
}

/**
 * 创建积分购买 webhook 载荷
 */
function createCreditPurchaseCheckout(params: {
  userId: string;
  amount: number;
  packageId: string;
  attribution: CheckoutAttributionContext | null;
  referralCode: string;
}): CreemCheckoutCompletedData {
  const paymentId = demoId(`payment_${params.packageId}`);

  return {
    id: `checkout_${paymentId}`,
    object: "checkout" as const,
    order: {
      object: "order" as const,
      id: `order_${paymentId}`,
      customer: `customer_${params.userId}`,
      product: `credits_${params.packageId}`,
      amount: params.amount,
      currency: demoCurrency,
      status: "paid" as const,
      type: "onetime" as const,
      transaction: paymentId,
    },
    customer: {
      id: `customer_${params.userId}`,
      email: params.userId,
    },
    product: {
      id: `credits_${params.packageId}`,
      name: `Credits ${params.packageId}`,
      price: params.amount,
      currency: demoCurrency,
      billing_type: "onetime" as const,
      billing_period: "",
    },
    status: "completed" as const,
    metadata: {
      userId: params.userId,
      type: "credit_purchase",
      credits: String(params.amount),
      packageId: params.packageId,
      referralCode: params.referralCode,
      attributedAgentUserId: params.attribution?.attributedAgentUserId ?? "",
      attributionId: params.attribution?.attributionId ?? "",
      campaign: params.attribution?.campaign ?? "",
      landingPath: params.attribution?.landingPath ?? "",
      visitorKey: params.attribution?.visitorKey ?? "",
    },
    mode: "test" as const,
  };
}

/**
 * 创建订阅 checkout 载荷
 */
function createSubscriptionCheckout(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
  amount: number;
  attribution: CheckoutAttributionContext | null;
  referralCode: string;
  periodStart: Date;
  periodEnd: Date;
}): CreemCheckoutCompletedData {
  const paymentId = demoId(`sub_checkout_${params.subscriptionId}`);

  return {
    id: `checkout_${paymentId}`,
    object: "checkout" as const,
    order: {
      object: "order" as const,
      id: `order_${paymentId}`,
      customer: `customer_${params.userId}`,
      product: params.priceId,
      amount: params.amount,
      currency: demoCurrency,
      status: "paid" as const,
      type: "subscription" as const,
      transaction: paymentId,
    },
    customer: {
      id: `customer_${params.userId}`,
      email: params.userId,
    },
    product: {
      id: params.priceId,
      name: "Subscription Plan",
      price: params.amount,
      currency: demoCurrency,
      billing_type: "recurring" as const,
      billing_period: "month" as const,
    },
    subscription: {
      id: params.subscriptionId,
      product: {
        id: params.priceId,
      },
      customer: {
        id: `customer_${params.userId}`,
        email: params.userId,
      },
      status: "active" as const,
      current_period_start_date: params.periodStart.toISOString(),
      current_period_end_date: params.periodEnd.toISOString(),
      cancel_at_period_end: false,
      metadata: {
        userId: params.userId,
      },
    },
    status: "completed" as const,
    metadata: {
      userId: params.userId,
      planId: "pro",
      referralCode: params.referralCode,
      attributedAgentUserId: params.attribution?.attributedAgentUserId ?? "",
      attributionId: params.attribution?.attributionId ?? "",
      campaign: params.attribution?.campaign ?? "",
      landingPath: params.attribution?.landingPath ?? "",
      visitorKey: params.attribution?.visitorKey ?? "",
    },
    mode: "test" as const,
  };
}

/**
 * 创建订阅生命周期载荷
 */
function createSubscriptionEvent(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
  periodStart: Date;
  periodEnd: Date;
}): CreemSubscription {
  return {
    id: params.subscriptionId,
    product: {
      id: params.priceId,
    },
    customer: {
      id: `customer_${params.userId}`,
      email: params.userId,
    },
    status: "active" as const,
    current_period_start_date: params.periodStart.toISOString(),
    current_period_end_date: params.periodEnd.toISOString(),
    cancel_at_period_end: false,
    metadata: {
      userId: params.userId,
    },
  };
}

/**
 * 读取订单对应的第一条订单项
 */
async function getOrderItem(orderId: string) {
  const [item] = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.orderId, orderId))
    .limit(1);

  return item;
}

/**
 * 按邮箱清理历史演示数据
 */
async function cleanupDemoUsers(emails: string[]) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.email, emails));
  const userIds = rows.map((row) => row.id);

  if (userIds.length === 0) {
    return;
  }

  const orderRows = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(
      or(
        inArray(salesOrder.userId, userIds),
        inArray(salesOrder.attributedAgentUserId, userIds)
      )
    );
  const orderIds = orderRows.map((row) => row.id);

  if (orderIds.length > 0) {
    const eventRows = await db
      .select({ id: commissionEvent.id })
      .from(commissionEvent)
      .where(inArray(commissionEvent.orderId, orderIds));
    const eventIds = eventRows.map((row) => row.id);

    const recordRows = await db
      .select({ id: commissionRecord.id })
      .from(commissionRecord)
      .where(
        or(
          inArray(commissionRecord.beneficiaryUserId, userIds),
          eventIds.length > 0
            ? inArray(commissionRecord.eventId, eventIds)
            : eq(commissionRecord.beneficiaryUserId, userIds[0] as string)
        )
      );
    const recordIds = recordRows.map((row) => row.id);

    await db
      .delete(commissionLedger)
      .where(
        or(
          inArray(commissionLedger.userId, userIds),
          recordIds.length > 0
            ? inArray(commissionLedger.recordId, recordIds)
            : eq(commissionLedger.userId, userIds[0] as string)
        )
      );

    if (eventIds.length > 0) {
      await db
        .delete(commissionRecord)
        .where(inArray(commissionRecord.eventId, eventIds));
      await db
        .delete(commissionEvent)
        .where(inArray(commissionEvent.id, eventIds));
    }

    await db
      .delete(salesAfterSalesEvent)
      .where(inArray(salesAfterSalesEvent.orderId, orderIds));
    await db
      .delete(salesOrderItem)
      .where(inArray(salesOrderItem.orderId, orderIds));
    await db.delete(salesOrder).where(inArray(salesOrder.id, orderIds));
  }

  await db
    .delete(withdrawalRequest)
    .where(inArray(withdrawalRequest.userId, userIds));
  await db
    .delete(commissionBalance)
    .where(inArray(commissionBalance.userId, userIds));
  await db
    .delete(distributionAttribution)
    .where(
      or(
        inArray(distributionAttribution.userId, userIds),
        inArray(distributionAttribution.agentUserId, userIds)
      )
    );
  await db
    .delete(distributionReferralCode)
    .where(inArray(distributionReferralCode.agentUserId, userIds));
  await db
    .delete(distributionProfile)
    .where(inArray(distributionProfile.userId, userIds));
  await db
    .delete(creditsTransaction)
    .where(inArray(creditsTransaction.userId, userIds));
  await db.delete(creditsBatch).where(inArray(creditsBatch.userId, userIds));
  await db
    .delete(creditsBalance)
    .where(inArray(creditsBalance.userId, userIds));
  await db
    .delete(subscription)
    .where(inArray(subscription.userId, userIds));
  await db.delete(session).where(inArray(session.userId, userIds));
  await db.delete(account).where(inArray(account.userId, userIds));
  await db.delete(user).where(inArray(user.id, userIds));
}

/**
 * 清理历史演示规则
 */
async function cleanupDemoRules() {
  await db
    .delete(commissionRule)
    .where(inArray(commissionRule.id, Object.values(demoRuleIds)));
}

/**
 * 输出演示账号和关键观察点
 */
function logDemoSummary(params: {
  alphaUserId: string;
  betaUserId: string;
  gammaUserId: string;
  adminUserId: string;
  renewalOrderId: string;
  renewalEventId: string | null;
}) {
  console.log("\n=== Distribution Demo Seeded ===");
  console.log("前端登录账号");
  console.log(
    JSON.stringify(
      [
        {
          role: "admin",
          userId: params.adminUserId,
          email: demoUsers.admin.email,
          password: demoPassword,
          page: "/en/admin/distribution",
        },
        {
          role: "agent-alpha",
          userId: params.alphaUserId,
          email: demoUsers.alpha.email,
          password: demoPassword,
          page: "/en/dashboard/distribution",
        },
        {
          role: "agent-beta",
          userId: params.betaUserId,
          email: demoUsers.beta.email,
          password: demoPassword,
          page: "/en/dashboard/distribution",
        },
        {
          role: "agent-gamma",
          userId: params.gammaUserId,
          email: demoUsers.gamma.email,
          password: demoPassword,
          page: "/en/dashboard/distribution",
        },
      ],
      null,
      2
    )
  );
  console.log("重点观察");
  console.log(
    JSON.stringify(
      {
        alpha: [
          "可提现、冻结、冲正、已提现、待处理提现同时存在",
          "存在部分退款和全额退款订单",
          "存在推广码、推广成交订单、佣金记录、提现记录",
        ],
        beta: [
          "存在拒付/退货后的冲正记录",
          "同时保留冻结中和可提现佣金",
        ],
        gamma: [
          "只有代理资料和推广码，没有订单",
        ],
        renewalCheck: {
          renewalOrderId: params.renewalOrderId,
          renewalCommissionEventId: params.renewalEventId,
          note: "如果这里是 null，说明续费订单没有生成佣金，当前实现需要重点复核",
        },
      },
      null,
      2
    )
  );
}

describeIfDemo("Distribution Demo Simulation", () => {
  it("应该写入可用于前端验收的完整分销场景数据", async () => {
    process.env.NEXT_PUBLIC_CREEM_PRICE_STARTER_MONTHLY ??= "demo_starter_monthly";
    process.env.NEXT_PUBLIC_CREEM_PRICE_STARTER_YEARLY ??= "demo_starter_yearly";
    process.env.NEXT_PUBLIC_CREEM_PRICE_PRO_MONTHLY ??= "demo_pro_monthly";
    process.env.NEXT_PUBLIC_CREEM_PRICE_PRO_YEARLY ??= "demo_pro_yearly";
    process.env.NEXT_PUBLIC_CREEM_PRICE_ULTRA_MONTHLY ??= "demo_ultra_monthly";
    process.env.NEXT_PUBLIC_CREEM_PRICE_ULTRA_YEARLY ??= "demo_ultra_yearly";

    const [
      routeModule,
      attributionModule,
      commissionModule,
      orderModule,
      queryModule,
      paymentConfigModule,
    ] = await Promise.all([
      import("@/app/api/webhooks/creem/route"),
      import("@/features/distribution/attribution"),
      import("@/features/distribution/commission"),
      import("@/features/distribution/orders"),
      import("@/features/distribution/queries"),
      import("@/config/payment"),
    ]);

    const {
      handleCheckoutCompleted,
      handleSubscriptionActive,
      handleSubscriptionRenewed,
    } = routeModule;
    const { resolveCheckoutAttributionFromPayload } = attributionModule;
    const { releaseAvailableCommissionRecords } = commissionModule;
    const { applySalesAfterSalesEvent } = orderModule;
    const { getDistributionDashboardData, getAdminDistributionOverview } =
      queryModule;
    const { PRICE_IDS } = paymentConfigModule;

    const demoEmails = [
      demoUsers.admin.email,
      demoUsers.alpha.email,
      demoUsers.beta.email,
      demoUsers.gamma.email,
      ...demoUsers.buyers,
    ];

    await cleanupDemoUsers(demoEmails);
    await cleanupDemoRules();

    await db.insert(commissionRule).values([
      {
        id: demoRuleIds.credit,
        status: "active",
        orderType: "credit_purchase",
        productType: "credit_package",
        commissionLevel: 1,
        calculationMode: "rate",
        rate: 15,
        freezeDays: 7,
        appliesToFirstPurchase: false,
        appliesToRenewal: false,
        appliesToCreditPackage: true,
        priority: 100,
      },
      {
        id: demoRuleIds.subscription,
        status: "active",
        orderType: "subscription",
        productType: "subscription",
        commissionLevel: 1,
        calculationMode: "rate",
        rate: 20,
        freezeDays: 2,
        appliesToFirstPurchase: true,
        appliesToRenewal: true,
        appliesToCreditPackage: false,
        priority: 90,
      },
    ]);

    const adminUserId = await createDemoUser({
      email: demoUsers.admin.email,
      name: demoUsers.admin.name,
      role: demoUsers.admin.role,
    });
    const alphaUserId = await createDemoUser({
      email: demoUsers.alpha.email,
      name: demoUsers.alpha.name,
      role: demoUsers.alpha.role,
    });
    const betaUserId = await createDemoUser({
      email: demoUsers.beta.email,
      name: demoUsers.beta.name,
      role: demoUsers.beta.role,
    });
    const gammaUserId = await createDemoUser({
      email: demoUsers.gamma.email,
      name: demoUsers.gamma.name,
      role: demoUsers.gamma.role,
    });

    const buyerIds: string[] = [];
    for (const [index, email] of demoUsers.buyers.entries()) {
      buyerIds.push(
        await createDemoUser({
          email,
          name: `Distribution Buyer ${index + 1}`,
        })
      );
    }

    await createDemoAgentProfile({
      userId: alphaUserId,
      displayName: "Alpha Travel Partners",
      agentLevel: "L1",
      depth: 1,
      path: `root/${alphaUserId}`,
    });
    await createDemoAgentProfile({
      userId: betaUserId,
      displayName: "Beta Campus Alliance",
      agentLevel: "L1",
      depth: 2,
      inviterUserId: alphaUserId,
      path: `root/${alphaUserId}/${betaUserId}`,
    });
    await createDemoAgentProfile({
      userId: gammaUserId,
      displayName: "Gamma Silent Channel",
      agentLevel: "L1",
      depth: 1,
      path: `root/${gammaUserId}`,
      status: "inactive",
    });

    const alphaMainCode = await createDemoReferralCode({
      agentUserId: alphaUserId,
      code: "alpha-main",
      campaign: "spring-launch",
      landingPath: "/pricing",
    });
    const alphaCourseCode = await createDemoReferralCode({
      agentUserId: alphaUserId,
      code: "alpha-campus",
      campaign: "campus-campaign",
      landingPath: "/features",
    });
    await createDemoReferralCode({
      agentUserId: betaUserId,
      code: "beta-main",
      campaign: "community-promo",
      landingPath: "/pricing",
    });
    await createDemoReferralCode({
      agentUserId: gammaUserId,
      code: "gamma-idle",
      campaign: "idle-channel",
      landingPath: "/",
      status: "inactive",
    });

    const attributionA = await resolveCheckoutAttributionFromPayload(
      buyerIds[0] as string,
      {
        referralCode: alphaMainCode.code,
        campaign: alphaMainCode.campaign ?? null,
        landingPath: alphaMainCode.landingPath ?? "/",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_a"),
      }
    );
    const attributionB = await resolveCheckoutAttributionFromPayload(
      buyerIds[1] as string,
      {
        referralCode: alphaCourseCode.code,
        campaign: alphaCourseCode.campaign ?? null,
        landingPath: alphaCourseCode.landingPath ?? "/",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_b"),
      }
    );
    const attributionC = await resolveCheckoutAttributionFromPayload(
      buyerIds[2] as string,
      {
        referralCode: alphaMainCode.code,
        campaign: alphaMainCode.campaign ?? null,
        landingPath: alphaMainCode.landingPath ?? "/",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_c"),
      }
    );
    const attributionD = await resolveCheckoutAttributionFromPayload(
      buyerIds[3] as string,
      {
        referralCode: alphaMainCode.code,
        campaign: alphaMainCode.campaign ?? null,
        landingPath: alphaMainCode.landingPath ?? "/",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_d"),
      }
    );
    const attributionE = await resolveCheckoutAttributionFromPayload(
      buyerIds[4] as string,
      {
        referralCode: "beta-main",
        campaign: "community-promo",
        landingPath: "/pricing",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_e"),
      }
    );
    const attributionF = await resolveCheckoutAttributionFromPayload(
      buyerIds[5] as string,
      {
        referralCode: "beta-main",
        campaign: "community-promo",
        landingPath: "/pricing",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_f"),
      }
    );
    const attributionG = await resolveCheckoutAttributionFromPayload(
      buyerIds[6] as string,
      {
        referralCode: "beta-main",
        campaign: "community-promo",
        landingPath: "/pricing",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_g"),
      }
    );
    const attributionH = await resolveCheckoutAttributionFromPayload(
      buyerIds[7] as string,
      {
        referralCode: alphaMainCode.code,
        campaign: alphaMainCode.campaign ?? null,
        landingPath: alphaMainCode.landingPath ?? "/",
        source: "query",
        capturedAt: new Date().toISOString(),
        visitorKey: demoId("visitor_h"),
      }
    );

    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[0] as string,
        amount: 24_000,
        packageId: "alpha-available-partial",
        attribution: attributionA,
        referralCode: alphaMainCode.code,
      })
    );
    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[1] as string,
        amount: 18_000,
        packageId: "alpha-available-clean",
        attribution: attributionB,
        referralCode: alphaCourseCode.code,
      })
    );

    const alphaSubscriptionId = demoId("alpha_sub");
    const alphaSubscriptionStart = new Date("2026-03-01T00:00:00.000Z");
    const alphaSubscriptionEnd = new Date("2026-04-01T00:00:00.000Z");
    await handleCheckoutCompleted(
      createSubscriptionCheckout({
        userId: buyerIds[2] as string,
        subscriptionId: alphaSubscriptionId,
        priceId: PRICE_IDS.PRO_MONTHLY,
        amount: 900,
        attribution: attributionC,
        referralCode: alphaMainCode.code,
        periodStart: alphaSubscriptionStart,
        periodEnd: alphaSubscriptionEnd,
      })
    );
    await handleSubscriptionActive(
      createSubscriptionEvent({
        userId: buyerIds[2] as string,
        subscriptionId: alphaSubscriptionId,
        priceId: PRICE_IDS.PRO_MONTHLY,
        periodStart: alphaSubscriptionStart,
        periodEnd: alphaSubscriptionEnd,
      })
    );

    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[4] as string,
        amount: 20_000,
        packageId: "beta-chargeback",
        attribution: attributionE,
        referralCode: "beta-main",
      })
    );
    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[5] as string,
        amount: 8_000,
        packageId: "beta-available-clean",
        attribution: attributionF,
        referralCode: "beta-main",
      })
    );

    await releaseAvailableCommissionRecords(new Date("2026-04-20T00:00:00.000Z"));

    const [alphaPartialOrder] = await db
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, buyerIds[0] as string))
      .limit(1);
    const alphaPartialItem = await getOrderItem(alphaPartialOrder!.id);
    await applySalesAfterSalesEvent({
      orderId: alphaPartialOrder!.id,
      orderItemId: alphaPartialItem!.id,
      eventType: "partial_refund",
      eventIdempotencyKey: demoId("after_sales_partial"),
      amount: 6_000,
      currency: demoCurrency,
      reason: "demo_partial_refund",
    });

    const [betaChargebackOrder] = await db
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, buyerIds[4] as string))
      .limit(1);
    const betaChargebackItem = await getOrderItem(betaChargebackOrder!.id);
    await applySalesAfterSalesEvent({
      orderId: betaChargebackOrder!.id,
      orderItemId: betaChargebackItem!.id,
      eventType: "chargeback",
      eventIdempotencyKey: demoId("after_sales_chargeback"),
      amount: 20_000,
      currency: demoCurrency,
      reason: "demo_chargeback",
    });

    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[3] as string,
        amount: 12_000,
        packageId: "alpha-refunded",
        attribution: attributionD,
        referralCode: alphaMainCode.code,
      })
    );
    const [alphaRefundedOrder] = await db
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, buyerIds[3] as string))
      .limit(1);
    const alphaRefundedItem = await getOrderItem(alphaRefundedOrder!.id);
    await applySalesAfterSalesEvent({
      orderId: alphaRefundedOrder!.id,
      orderItemId: alphaRefundedItem!.id,
      eventType: "refunded",
      eventIdempotencyKey: demoId("after_sales_refunded"),
      amount: 12_000,
      currency: demoCurrency,
      reason: "demo_full_refund",
    });

    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[6] as string,
        amount: 10_000,
        packageId: "beta-frozen",
        attribution: attributionG,
        referralCode: "beta-main",
      })
    );
    await handleCheckoutCompleted(
      createCreditPurchaseCheckout({
        userId: buyerIds[7] as string,
        amount: 8_000,
        packageId: "alpha-frozen-pending",
        attribution: attributionH,
        referralCode: alphaMainCode.code,
      })
    );

    const alphaRenewalStart = new Date("2026-04-01T00:00:00.000Z");
    const alphaRenewalEnd = new Date("2026-05-01T00:00:00.000Z");
    await handleSubscriptionRenewed(
      createSubscriptionEvent({
        userId: buyerIds[2] as string,
        subscriptionId: alphaSubscriptionId,
        priceId: PRICE_IDS.PRO_MONTHLY,
        periodStart: alphaRenewalStart,
        periodEnd: alphaRenewalEnd,
      })
    );

    const { createWithdrawalRequest, rejectWithdrawalRequest, markWithdrawalRequestPaid } =
      await import("@/features/distribution/withdrawal");

    const alphaPaidWithdrawalId = await createWithdrawalRequest({
      userId: alphaUserId,
      amount: 1_500,
      feeAmount: 50,
      currency: demoCurrency,
      payeeSnapshot: {
        channel: "bank_transfer",
        accountName: "Agent Alpha",
        accountNo: "ALPHA-PAID-001",
        note: "demo paid",
      },
    });
    await markWithdrawalRequestPaid({
      requestId: alphaPaidWithdrawalId,
      operatorUserId: adminUserId,
      operatorNote: "demo paid transfer",
    });

    const alphaRejectedWithdrawalId = await createWithdrawalRequest({
      userId: alphaUserId,
      amount: 700,
      feeAmount: 20,
      currency: demoCurrency,
      payeeSnapshot: {
        channel: "alipay",
        accountName: "Agent Alpha",
        accountNo: "ALPHA-REJECT-001",
        note: "demo reject",
      },
    });
    await rejectWithdrawalRequest({
      requestId: alphaRejectedWithdrawalId,
      operatorUserId: adminUserId,
      operatorNote: "demo reject due to mismatch",
    });

    await createWithdrawalRequest({
      userId: alphaUserId,
      amount: 1_000,
      feeAmount: 50,
      currency: demoCurrency,
      payeeSnapshot: {
        channel: "wechat",
        accountName: "Agent Alpha",
        accountNo: "ALPHA-PENDING-001",
        note: "demo pending",
      },
    });

    const [alphaBalance] = await db
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, alphaUserId))
      .limit(1);
    const [betaBalance] = await db
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, betaUserId))
      .limit(1);
    const [alphaProfile] = await db
      .select()
      .from(distributionProfile)
      .where(eq(distributionProfile.userId, alphaUserId))
      .limit(1);
    const [renewalOrder] = await db
      .select()
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.userId, buyerIds[2] as string),
          eq(salesOrder.eventType, "subscription.renewed")
        )
      )
      .limit(1);
    const [renewalCommissionEvent] = renewalOrder
      ? await db
          .select()
          .from(commissionEvent)
          .where(
            and(
              eq(commissionEvent.orderId, renewalOrder.id),
              eq(commissionEvent.triggerType, "subscription_cycle")
            )
          )
          .limit(1)
      : [];

    expect(alphaProfile).toBeTruthy();
    expect(alphaBalance).toMatchObject({
      totalEarned: 9_480,
      availableAmount: 2_980,
      frozenAmount: 2_250,
      withdrawnAmount: 1_550,
      reversedAmount: 2_700,
    });
    expect(betaBalance).toMatchObject({
      totalEarned: 5_700,
      availableAmount: 1_200,
      frozenAmount: 1_500,
      withdrawnAmount: 0,
      reversedAmount: 3_000,
    });

    const alphaDashboard = await getDistributionDashboardData(alphaUserId);
    const betaDashboard = await getDistributionDashboardData(betaUserId);
    const gammaDashboard = await getDistributionDashboardData(gammaUserId);
    const adminOverview = await getAdminDistributionOverview();

    expect(alphaDashboard.summary.attributedOrders).toBeGreaterThanOrEqual(5);
    expect(alphaDashboard.summary.refundedOrders).toBeGreaterThanOrEqual(2);
    expect(alphaDashboard.summary.pendingWithdrawals).toBe(1);
    expect(betaDashboard.summary.attributedOrders).toBeGreaterThanOrEqual(3);
    expect(gammaDashboard.summary.attributedOrders).toBe(0);
    expect(adminOverview.summary.activeAgents).toBeGreaterThanOrEqual(2);
    expect(adminOverview.summary.pendingWithdrawals).toBeGreaterThanOrEqual(1);

    logDemoSummary({
      alphaUserId,
      betaUserId,
      gammaUserId,
      adminUserId,
      renewalOrderId: renewalOrder?.id ?? "missing",
      renewalEventId: renewalCommissionEvent?.id ?? null,
    });
  });
});
