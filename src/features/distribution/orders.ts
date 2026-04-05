import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  distributionAttribution,
  salesOrder,
  salesOrderItem,
} from "@/db/schema";
import type {
  CreemCheckoutCompletedData,
  CreemSubscription,
} from "@/features/payment/creem";

/**
 * 统一订单中的归因快照
 */
interface PaymentOrderAttribution {
  referralCode: string | null;
  attributedAgentUserId: string | null;
  attributionId: string | null;
  attributionSnapshot: Record<string, unknown> | null;
}

/**
 * 统一订单标准载荷
 */
interface PaymentOrderPayload {
  order: typeof salesOrder.$inferInsert;
  item: typeof salesOrderItem.$inferInsert;
}

/**
 * 生成订单更新时可复用的字段
 */
function toSalesOrderUpdate(
  payload: PaymentOrderPayload["order"]
): Omit<PaymentOrderPayload["order"], "id"> {
  const { id: _id, ...updateData } = payload;
  return updateData;
}

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
 * 从 metadata 或归因表中解析订单归因
 */
async function getPaymentOrderAttribution(
  metadata: Record<string, string> | undefined
): Promise<PaymentOrderAttribution> {
  const referralCode = metadata?.referralCode ?? null;
  const attributedAgentUserId = metadata?.attributedAgentUserId ?? null;
  const attributionId = metadata?.attributionId ?? null;

  if (!attributionId) {
    return {
      referralCode,
      attributedAgentUserId,
      attributionId,
      attributionSnapshot: referralCode
        ? {
            referralCode,
            attributedAgentUserId,
            campaign: metadata?.campaign || null,
            landingPath: metadata?.landingPath || null,
            visitorKey: metadata?.visitorKey || null,
          }
        : null,
    };
  }

  const [attribution] = await db
    .select({
      referralCode: distributionAttribution.referralCode,
      agentUserId: distributionAttribution.agentUserId,
      visitorKey: distributionAttribution.visitorKey,
      campaign: distributionAttribution.campaign,
      landingPath: distributionAttribution.landingPath,
      source: distributionAttribution.source,
      boundReason: distributionAttribution.boundReason,
      boundAt: distributionAttribution.boundAt,
      snapshot: distributionAttribution.snapshot,
    })
    .from(distributionAttribution)
    .where(eq(distributionAttribution.id, attributionId))
    .limit(1);

  if (!attribution) {
    return {
      referralCode,
      attributedAgentUserId,
      attributionId,
      attributionSnapshot: null,
    };
  }

  return {
    referralCode: attribution.referralCode,
    attributedAgentUserId: attribution.agentUserId,
    attributionId,
    attributionSnapshot: {
      referralCode: attribution.referralCode,
      agentUserId: attribution.agentUserId,
      visitorKey: attribution.visitorKey,
      campaign: attribution.campaign,
      landingPath: attribution.landingPath,
      source: attribution.source,
      boundReason: attribution.boundReason,
      boundAt: attribution.boundAt?.toISOString?.() ?? null,
      ...(attribution.snapshot ?? {}),
    },
  };
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
 * 构造 checkout.completed 的统一订单标准载荷
 */
async function buildPaymentOrderPayloadFromCheckoutCompleted(
  userId: string,
  data: CreemCheckoutCompletedData
): Promise<PaymentOrderPayload> {
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
  const attribution = await getPaymentOrderAttribution(data.metadata);

  return {
    order: {
      id: crypto.randomUUID(),
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
      referralCode: attribution.referralCode,
      attributedAgentUserId: attribution.attributedAgentUserId,
      attributionId: attribution.attributionId,
      attributionSnapshot: attribution.attributionSnapshot,
      metadata: {
        checkoutStatus: data.status,
        checkoutMode: data.mode,
        packageId: data.metadata?.packageId,
        planId: data.metadata?.planId,
        referralCode: attribution.referralCode,
        attributedAgentUserId: attribution.attributedAgentUserId,
        attributionId: attribution.attributionId,
        campaign: data.metadata?.campaign,
        landingPath: data.metadata?.landingPath,
        visitorKey: data.metadata?.visitorKey,
        clientOrderKey: data.metadata?.clientOrderKey,
      },
    },
    item: {
      id: crypto.randomUUID(),
      orderId: "",
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
        referralCode: attribution.referralCode,
        clientOrderKey: data.metadata?.clientOrderKey,
      },
    },
  };
}

/**
 * 构造订阅生命周期事件的统一订单标准载荷
 */
function buildPaymentOrderPayloadFromSubscriptionEvent(
  userId: string,
  sub: CreemSubscription,
  eventType: "subscription.active" | "subscription.renewed" | "subscription.paid"
): PaymentOrderPayload {
  const productId = getSubscriptionProductId(sub);
  const eventTime = new Date(sub.current_period_start_date);
  const eventIdempotencyKey = getSubscriptionEventIdempotencyKey(sub, eventType);

  return {
    order: {
      id: crypto.randomUUID(),
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
    },
    item: {
      id: crypto.randomUUID(),
      orderId: "",
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
    },
  };
}

/**
 * 从 checkout.completed 落统一订单
 */
export async function upsertSalesOrderFromCheckoutCompleted(
  userId: string,
  data: CreemCheckoutCompletedData
) {
  const payload = await buildPaymentOrderPayloadFromCheckoutCompleted(userId, data);

  const [existingOrder] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(eq(salesOrder.eventIdempotencyKey, payload.order.eventIdempotencyKey))
    .limit(1);

  if (existingOrder) {
    await db
      .update(salesOrder)
      .set({
        ...toSalesOrderUpdate(payload.order),
        updatedAt: new Date(),
      })
      .where(eq(salesOrder.id, existingOrder.id));
    return existingOrder.id;
  }

  const orderId = payload.order.id;
  await db.insert(salesOrder).values(payload.order);

  await db.insert(salesOrderItem).values({
    ...payload.item,
    orderId,
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
  const payload = buildPaymentOrderPayloadFromSubscriptionEvent(
    userId,
    sub,
    eventType
  );

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
          eventType: payload.order.eventType,
          eventTime: payload.order.eventTime,
          updatedAt: new Date(),
        })
        .where(eq(salesOrder.id, checkoutOrder.id));
      return checkoutOrder.id;
    }
  }

  const [existingOrder] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(eq(salesOrder.eventIdempotencyKey, payload.order.eventIdempotencyKey))
    .limit(1);

  if (existingOrder) {
    return existingOrder.id;
  }

  const orderId = payload.order.id;
  await db.insert(salesOrder).values(payload.order);

  await db.insert(salesOrderItem).values({
    ...payload.item,
    orderId,
  });

  return orderId;
}
