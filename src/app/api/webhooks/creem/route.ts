import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { CREDITS_EXPIRY_DAYS } from "@/features/credits/config";
import { grantCredits } from "@/features/credits/core";
import { db } from "@/db";
import {
  creditsBatch,
  salesOrder,
  salesOrderItem,
  subscription,
  user,
} from "@/db/schema";
import {
  constructCreemEvent,
  type CreemCheckoutCompletedData,
  type CreemSubscription,
} from "@/features/payment/creem";
import { getPlanFromPriceId } from "@/config/subscription-plan";
import { SUBSCRIPTION_MONTHLY_CREDITS } from "@/config/payment";
import { logError, logEvent } from "@/lib/logger";
import { withApiLogging } from "@/lib/api-logger";

/** 从 CreemSubscription 中安全提取产品 ID */
function getProductId(sub: CreemSubscription): string {
  return typeof sub.product === "string" ? sub.product : sub.product?.id ?? "";
}

/** 从 Checkout 事件中安全提取产品 ID */
export function getCheckoutProductId(data: CreemCheckoutCompletedData): string {
  return data.product?.id ?? data.order?.product ?? "";
}

/** 获取一次性支付的幂等引用 */
export function getCheckoutPaymentReference(data: CreemCheckoutCompletedData): string {
  return data.order?.transaction ?? data.order?.id ?? data.id;
}

/** 获取 checkout.completed 的事件幂等键 */
export function getCheckoutEventIdempotencyKey(
  data: CreemCheckoutCompletedData
): string {
  return `creem:checkout.completed:${data.id}`;
}

/** 将 Creem 金额统一转成订单域使用的整数 */
function normalizeOrderAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.round(value ?? 0) : 0;
}

/**
 * Creem Webhook 处理器
 *
 * 处理来自 Creem 的事件通知
 * 文档: https://docs.creem.io/code/webhooks
 */
export const POST = withApiLogging(async (req: Request) => {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("creem-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing creem-signature header" },
      { status: 400 }
    );
  }

  let event;

  try {
    // 验证 Webhook 签名并解析事件
    event = constructCreemEvent(body, signature);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logError(err, { source: "creem-webhook", stage: "signature" });
    return NextResponse.json(
      { error: `Webhook Error: ${errorMessage}` },
      { status: 400 }
    );
  }

  try {
    // 处理不同类型的事件
    switch (event.eventType) {
      // ============================================
      // Checkout 完成事件
      // ============================================
      case "checkout.completed": {
        await handleCheckoutCompleted(event.object as CreemCheckoutCompletedData);
        break;
      }

      // ============================================
      // 订阅相关事件
      // ============================================
      case "subscription.active": {
        await handleSubscriptionActive(event.object as CreemSubscription);
        break;
      }

      case "subscription.renewed":
      case "subscription.paid": {
        await handleSubscriptionRenewed(event.object as CreemSubscription);
        break;
      }

      case "subscription.canceled": {
        await handleSubscriptionCanceled(event.object as CreemSubscription);
        break;
      }

      case "subscription.past_due": {
        await handleSubscriptionPastDue(event.object as CreemSubscription);
        break;
      }

      case "subscription.paused": {
        await handleSubscriptionPaused(event.object as CreemSubscription);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logError(error, { source: "creem-webhook", stage: "handler" });
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
});

// ============================================
// Checkout 完成处理
// ============================================

/**
 * 处理 Checkout 完成事件
 *
 * 当用户完成支付后，创建或更新订阅记录
 */
export async function handleCheckoutCompleted(data: CreemCheckoutCompletedData) {
  const userId = data.metadata?.userId;
  const customerId = data.customer.id;
  const productId = getCheckoutProductId(data);

  if (!userId) {
    console.error("Missing userId in checkout metadata");
    return;
  }

  // 更新用户的 customerId
  await db
    .update(user)
    .set({ customerId })
    .where(eq(user.id, userId));

  await upsertSalesOrderFromCheckoutCompleted(userId, data);

  // 积分购买走一次性支付分支，不创建订阅
  if (data.metadata?.type === "credit_purchase") {
    await handleCreditPurchaseCompleted(userId, data);
  }

  // 如果有订阅信息，创建订阅记录
  if (data.subscription) {
    await createOrUpdateSubscription(userId, data.subscription);
  }

  logEvent("payment.checkout.completed", {
    userId,
    customerId,
    productId,
    subscriptionId: data.subscription?.id,
    billingType: data.product?.billing_type,
    checkoutType: data.metadata?.type ?? "subscription",
  });
}

/**
 * 从 checkout.completed 落统一订单
 *
 * 这里只处理最小订单骨架，后续再扩展归因、售后和统一事件层
 */
async function upsertSalesOrderFromCheckoutCompleted(
  userId: string,
  data: CreemCheckoutCompletedData
) {
  const eventIdempotencyKey = getCheckoutEventIdempotencyKey(data);
  const orderType =
    data.metadata?.type === "credit_purchase" ? "credit_purchase" : "subscription";
  const productType =
    orderType === "credit_purchase" ? "credit_package" : "subscription";
  const productId = getCheckoutProductId(data);
  const paymentId = getCheckoutPaymentReference(data);
  const orderAmount = normalizeOrderAmount(
    data.order?.amount ?? data.product?.price
  );
  const currency = data.order?.currency ?? data.product?.currency ?? "USD";
  const paidAt = new Date();

  const [existingOrder] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(eq(salesOrder.eventIdempotencyKey, eventIdempotencyKey))
    .limit(1);

  if (existingOrder) {
    await db
      .update(salesOrder)
      .set({
        userId,
        provider: "creem",
        providerOrderId: data.order?.id ?? null,
        providerCheckoutId: data.id,
        providerSubscriptionId: data.subscription?.id ?? null,
        providerPaymentId: paymentId,
        orderType,
        status: "paid",
        afterSalesStatus: "none",
        currency,
        grossAmount: orderAmount,
        paidAt,
        eventTime: paidAt,
        eventType: "checkout.completed",
        metadata: {
          checkoutStatus: data.status,
          checkoutMode: data.mode,
          packageId: data.metadata?.packageId,
          planId: data.metadata?.planId,
        },
        updatedAt: new Date(),
      })
      .where(eq(salesOrder.id, existingOrder.id));
    return existingOrder.id;
  }

  const orderId = crypto.randomUUID();
  await db.insert(salesOrder).values({
    id: orderId,
    userId,
    provider: "creem",
    providerOrderId: data.order?.id ?? null,
    providerCheckoutId: data.id,
    providerSubscriptionId: data.subscription?.id ?? null,
    providerPaymentId: paymentId,
    orderType,
    status: "paid",
    afterSalesStatus: "none",
    currency,
    grossAmount: orderAmount,
    paidAt,
    eventTime: paidAt,
    eventType: "checkout.completed",
    eventIdempotencyKey,
    metadata: {
      checkoutStatus: data.status,
      checkoutMode: data.mode,
      packageId: data.metadata?.packageId,
      planId: data.metadata?.planId,
    },
  });

  await db.insert(salesOrderItem).values({
    id: crypto.randomUUID(),
    orderId,
    productType,
    productId,
    priceId: productId || null,
    planId: data.metadata?.planId ?? null,
    quantity: 1,
    grossAmount: orderAmount,
    netAmount: orderAmount,
    commissionBaseAmount: orderAmount,
    refundedAmount: 0,
    refundableAmount: orderAmount,
    metadata: {
      packageId: data.metadata?.packageId,
      credits: data.metadata?.credits,
      subscriptionId: data.subscription?.id,
    },
  });

  return orderId;
}

/**
 * 处理积分购买完成事件
 *
 * 幂等键优先使用支付交易号，其次退化到订单号或 checkout id
 */
export async function handleCreditPurchaseCompleted(
  userId: string,
  data: CreemCheckoutCompletedData
) {
  const credits = Number(data.metadata?.credits ?? 0);
  const packageId = data.metadata?.packageId;
  const paymentId = getCheckoutPaymentReference(data);

  if (!Number.isFinite(credits) || credits <= 0) {
    console.error("Invalid credits amount in checkout metadata:", data.metadata);
    return;
  }

  // 使用 purchase + sourceRef 保证同一笔支付不会重复发积分
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceType, "purchase"),
        eq(creditsBatch.sourceRef, paymentId)
      )
    )
    .limit(1);

  if (existingBatch) {
    console.log(`Credits already granted for payment: ${paymentId}, skipping`);
    return;
  }

  const expiresAt = CREDITS_EXPIRY_DAYS
    ? new Date(Date.now() + CREDITS_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    : null;

  await grantCredits({
    userId,
    amount: credits,
    sourceType: "purchase",
    debitAccount: `PAYMENT:${paymentId}`,
    transactionType: "purchase",
    expiresAt,
    sourceRef: paymentId,
    description: `购买 ${credits} 积分 (${packageId ?? "custom"})`,
    metadata: {
      checkoutId: data.id,
      orderId: data.order?.id,
      transactionId: data.order?.transaction,
      packageId,
      productId: getCheckoutProductId(data),
    },
  });

  logEvent("credits.purchased", {
    userId,
    amount: credits,
    paymentId,
    packageId,
    source: "creem",
  });
}

// ============================================
// 订阅事件处理
// ============================================

/**
 * 处理订阅激活事件
 *
 * 首次订阅激活时触发，发放积分
 */
async function handleSubscriptionActive(sub: CreemSubscription) {
  const userId = sub.metadata?.userId;

  if (!userId) {
    // 尝试从数据库查找
    const [existingSub] = await db
      .select({ userId: subscription.userId })
      .from(subscription)
      .where(eq(subscription.subscriptionId, sub.id))
      .limit(1);

    if (!existingSub) {
      console.error("Cannot find userId for subscription:", sub.id);
      return;
    }

    await updateSubscriptionStatus(sub);
    await grantSubscriptionCredits(existingSub.userId, sub, "subscription_create");
    logEvent("payment.subscription.created", {
      userId: existingSub.userId,
      subscriptionId: sub.id,
      priceId: getProductId(sub),
      status: sub.status,
    });
    return;
  }

  await createOrUpdateSubscription(userId, sub);
  await grantSubscriptionCredits(userId, sub, "subscription_create");
  logEvent("payment.subscription.created", {
    userId,
    subscriptionId: sub.id,
    priceId: getProductId(sub),
    status: sub.status,
  });
}

/**
 * 处理订阅续期事件
 *
 * 订阅周期结束续费时触发，发放积分
 */
async function handleSubscriptionRenewed(sub: CreemSubscription) {
  await updateSubscriptionStatus(sub);

  // 从数据库获取 userId
  const [existingSub] = await db
    .select({ userId: subscription.userId })
    .from(subscription)
    .where(eq(subscription.subscriptionId, sub.id))
    .limit(1);

  if (!existingSub) {
    console.error("Subscription not found for renewal:", sub.id);
    return;
  }

  await grantSubscriptionCredits(existingSub.userId, sub, "subscription_cycle");
}

/**
 * 处理订阅取消事件
 */
async function handleSubscriptionCanceled(sub: CreemSubscription) {
  // 判断当前周期是否未结束
  const periodEnd = new Date(sub.current_period_end_date);
  const isStillInPeriod = periodEnd > new Date();

  if (isStillInPeriod) {
    // 周期未结束：保持 active，标记 cancelAtPeriodEnd
    // 不管 Creem 传来的 cancel_at_period_end 是什么值
    await db
      .update(subscription)
      .set({
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscription.subscriptionId, sub.id));
  } else {
    // 已过期：标记为 canceled
    await db
      .update(subscription)
      .set({
        status: "canceled",
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscription.subscriptionId, sub.id));
  }

  const [existingSub] = await db
    .select({ userId: subscription.userId })
    .from(subscription)
    .where(eq(subscription.subscriptionId, sub.id))
    .limit(1);

  logEvent("payment.subscription.canceled", {
    userId: existingSub?.userId,
    subscriptionId: sub.id,
    cancelAtPeriodEnd: isStillInPeriod,
    periodEnd: sub.current_period_end_date,
  });
}

/**
 * 处理订阅逾期事件
 */
async function handleSubscriptionPastDue(sub: CreemSubscription) {
  await db
    .update(subscription)
    .set({
      status: "past_due",
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, sub.id));

  console.log(`Subscription past due: ${sub.id}`);
}

/**
 * 处理订阅暂停事件
 */
async function handleSubscriptionPaused(sub: CreemSubscription) {
  await db
    .update(subscription)
    .set({
      status: "paused",
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, sub.id));

  console.log(`Subscription paused: ${sub.id}`);
}

// ============================================
// 辅助函数
// ============================================

/**
 * 创建或更新订阅记录
 */
async function createOrUpdateSubscription(userId: string, sub: CreemSubscription) {
  const [existingSub] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);

  const subscriptionData = {
    subscriptionId: sub.id,
    priceId: getProductId(sub),
    status: sub.status,
    currentPeriodStart: new Date(sub.current_period_start_date),
    currentPeriodEnd: new Date(sub.current_period_end_date),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: new Date(),
  };

  if (existingSub) {
    await db
      .update(subscription)
      .set(subscriptionData)
      .where(eq(subscription.userId, userId));
  } else {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      userId,
      ...subscriptionData,
    });
  }

  console.log(`Subscription created/updated for user ${userId}`);
}

/**
 * 更新订阅状态
 */
async function updateSubscriptionStatus(sub: CreemSubscription) {
  await db
    .update(subscription)
    .set({
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start_date),
      currentPeriodEnd: new Date(sub.current_period_end_date),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, sub.id));
}

/**
 * 发放订阅积分
 *
 * @param userId - 用户 ID
 * @param sub - 订阅信息
 * @param billingReason - 计费原因 (subscription_create | subscription_cycle)
 */
async function grantSubscriptionCredits(
  userId: string,
  sub: CreemSubscription,
  billingReason: "subscription_create" | "subscription_cycle"
) {
  const priceId = getProductId(sub);
  const planType = getPlanFromPriceId(priceId);

  if (!planType) {
    console.error(`Unknown priceId: ${priceId}`);
    return;
  }

  // 幂等性检查：同一订阅 + 同一周期只发放一次积分
  const periodKey = `${sub.id}:${sub.current_period_start_date}`;
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceRef, periodKey),
        eq(creditsBatch.sourceType, "subscription"),
      )
    )
    .limit(1);

  if (existingBatch) {
    console.log(`Credits already granted for subscription period: ${periodKey}, skipping`);
    return;
  }

  // 获取该计划的月度积分配额
  const monthlyCredits = SUBSCRIPTION_MONTHLY_CREDITS[planType as keyof typeof SUBSCRIPTION_MONTHLY_CREDITS];
  if (!monthlyCredits) {
    console.error(`No monthly credits configured for plan: ${planType}`);
    return;
  }

  // 判断是否为年付（通过周期长度判断）
  const periodStart = new Date(sub.current_period_start_date);
  const periodEnd = new Date(sub.current_period_end_date);
  const periodDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const isYearly = periodDays > 60; // 超过60天认为是年付

  // 计算应发放积分：月付发月度积分，年付发12个月积分
  const creditsToGrant = isYearly ? monthlyCredits * 12 : monthlyCredits;

  // 计算积分过期时间
  const expiresAt = CREDITS_EXPIRY_DAYS
    ? new Date(Date.now() + CREDITS_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    : null;

  // 发放积分
  try {
    const result = await grantCredits({
      userId,
      amount: creditsToGrant,
      sourceType: "subscription",
      debitAccount: `SUBSCRIPTION:${sub.id}`,
      transactionType: "monthly_grant",
      expiresAt,
      sourceRef: periodKey,
      description: isYearly
        ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} 年度订阅积分 (${monthlyCredits} × 12)`
        : `${planType.charAt(0).toUpperCase() + planType.slice(1)} 月度订阅积分`,
      metadata: {
        subscriptionId: sub.id,
        priceId,
        planType,
        billingReason,
        interval: isYearly ? "year" : "month",
        periodStart: sub.current_period_start_date,
        periodEnd: sub.current_period_end_date,
      },
    });

    console.log(
      `Credits granted for user ${userId}: ${creditsToGrant} credits (${planType} ${isYearly ? "yearly" : "monthly"}), batch ${result.batchId}`
    );
  } catch (error) {
    console.error("Failed to grant subscription credits:", error);
    // 不抛出错误，让 webhook 返回成功
    // 积分发放失败可通过日志追踪，手动补发
  }
}
