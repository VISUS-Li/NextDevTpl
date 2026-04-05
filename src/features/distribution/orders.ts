import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { salesOrder, salesOrderItem } from "@/db/schema";
import type {
  CreemCheckoutCompletedData,
  CreemSubscription,
} from "@/features/payment/creem";

/**
 * 从 Checkout 事件中安全提取产品 ID
 */
export function getCheckoutProductId(data: CreemCheckoutCompletedData): string {
  return data.product?.id ?? data.order?.product ?? "";
}

/**
 * 获取一次性支付或 Checkout 的支付引用
 */
export function getCheckoutPaymentReference(data: CreemCheckoutCompletedData): string {
  return data.order?.transaction ?? data.order?.id ?? data.id;
}

/**
 * 获取 checkout.completed 的事件幂等键
 */
export function getCheckoutEventIdempotencyKey(
  data: CreemCheckoutCompletedData
): string {
  return `creem:checkout.completed:${data.id}`;
}

/**
 * 从订阅对象中安全提取产品 ID
 */
export function getSubscriptionProductId(sub: CreemSubscription): string {
  return typeof sub.product === "string" ? sub.product : sub.product?.id ?? "";
}

/**
 * 将 Creem 金额统一转成订单域使用的整数
 */
function normalizeOrderAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.round(value ?? 0) : 0;
}

/**
 * 构造订阅生命周期事件的统一订单幂等键
 */
function getSubscriptionEventIdempotencyKey(
  sub: CreemSubscription,
  eventType: "subscription.active" | "subscription.renewed" | "subscription.paid"
) {
  const lifecycleType =
    eventType === "subscription.active"
      ? "subscription_create"
      : "subscription_cycle";
  return `creem:${lifecycleType}:${sub.id}:${sub.current_period_start_date}`;
}

/**
 * 从 checkout.completed 落统一订单
 */
export async function upsertSalesOrderFromCheckoutCompleted(
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
          referralCode: data.metadata?.referralCode,
          attributedAgentUserId: data.metadata?.attributedAgentUserId,
          attributionId: data.metadata?.attributionId,
          campaign: data.metadata?.campaign,
          landingPath: data.metadata?.landingPath,
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
      referralCode: data.metadata?.referralCode,
      attributedAgentUserId: data.metadata?.attributedAgentUserId,
      attributionId: data.metadata?.attributionId,
      campaign: data.metadata?.campaign,
      landingPath: data.metadata?.landingPath,
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
      referralCode: data.metadata?.referralCode,
    },
  });

  return orderId;
}

/**
 * 从订阅生命周期事件落统一订单
 *
 * `subscription.active` 优先确认首购 checkout 订单
 * `subscription.renewed` / `subscription.paid` 则创建新的续费订单
 */
export async function upsertSalesOrderFromSubscriptionEvent(
  userId: string,
  sub: CreemSubscription,
  eventType: "subscription.active" | "subscription.renewed" | "subscription.paid"
) {
  const productId = getSubscriptionProductId(sub);
  const eventTime = new Date(sub.current_period_start_date);
  const eventIdempotencyKey = getSubscriptionEventIdempotencyKey(sub, eventType);

  if (eventType === "subscription.active") {
    const [checkoutOrder] = await db
      .select({ id: salesOrder.id })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.providerSubscriptionId, sub.id),
          eq(salesOrder.eventType, "checkout.completed")
        )
      )
      .orderBy(desc(salesOrder.createdAt))
      .limit(1);

    if (checkoutOrder) {
      await db
        .update(salesOrder)
        .set({
          status: "confirmed",
          eventType,
          eventTime,
          updatedAt: new Date(),
        })
        .where(eq(salesOrder.id, checkoutOrder.id));
      return checkoutOrder.id;
    }
  }

  const [existingOrder] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(eq(salesOrder.eventIdempotencyKey, eventIdempotencyKey))
    .limit(1);

  if (existingOrder) {
    return existingOrder.id;
  }

  const orderId = crypto.randomUUID();
  await db.insert(salesOrder).values({
    id: orderId,
    userId,
    provider: "creem",
    providerSubscriptionId: sub.id,
    providerPaymentId: `${sub.id}:${sub.current_period_start_date}`,
    orderType: "subscription",
    status: eventType === "subscription.active" ? "confirmed" : "paid",
    afterSalesStatus: "none",
    currency: "USD",
    grossAmount: 0,
    paidAt: eventTime,
    eventTime,
    eventType,
    eventIdempotencyKey,
    metadata: {
      subscriptionId: sub.id,
      periodStart: sub.current_period_start_date,
      periodEnd: sub.current_period_end_date,
    },
  });

  await db.insert(salesOrderItem).values({
    id: crypto.randomUUID(),
    orderId,
    productType: "subscription",
    productId,
    priceId: productId || null,
    quantity: 1,
    grossAmount: 0,
    netAmount: 0,
    commissionBaseAmount: 0,
    refundedAmount: 0,
    refundableAmount: 0,
    metadata: {
      subscriptionId: sub.id,
      periodStart: sub.current_period_start_date,
      periodEnd: sub.current_period_end_date,
    },
  });

  return orderId;
}
