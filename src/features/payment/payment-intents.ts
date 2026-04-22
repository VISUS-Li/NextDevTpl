import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import type {
  NewPaymentIntent,
  PaymentIntent,
  PaymentIntentDisplayMode,
  PaymentIntentStatus,
  SalesOrderProvider,
} from "@/db/schema";
import { paymentIntent } from "@/db/schema";

/**
 * 创建支付意图时需要的最小字段。
 */
type CreatePaymentIntentParams = {
  userId: string;
  provider: SalesOrderProvider;
  packageId: string;
  credits: number;
  amount: number;
  currency: string;
  subject: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
};

/**
 * 支付渠道返回结果后，需要回写的字段。
 */
type UpdatePaymentIntentCheckoutParams = {
  intentId: string;
  displayMode: PaymentIntentDisplayMode;
  checkoutUrl?: string | null | undefined;
  qrCodeUrl?: string | null | undefined;
  providerOrderId?: string | null | undefined;
  providerCheckoutId?: string | null | undefined;
  providerPaymentId?: string | null | undefined;
  providerResponse?: Record<string, unknown> | null | undefined;
  expiresAt?: Date | null | undefined;
  status?: PaymentIntentStatus | undefined;
};

/**
 * 支付成功后回写本地单据。
 */
type MarkPaymentIntentPaidParams = {
  intentId: string;
  providerOrderId?: string | null | undefined;
  providerPaymentId?: string | null | undefined;
  providerResponse?: Record<string, unknown> | null | undefined;
  paidAt?: Date | undefined;
};

/**
 * 生成统一商户订单号。
 */
export function generateOutTradeNo(params: {
  provider: SalesOrderProvider;
  userId: string;
}) {
  const userPart =
    params.userId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "user";
  const providerPart = params.provider.replace(/[^a-zA-Z0-9]/g, "");
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `pay_${providerPart}_${userPart}_${Date.now()}_${randomPart}`;
}

/**
 * 创建本地待支付单。
 */
export async function createCreditPurchasePaymentIntent(
  params: CreatePaymentIntentParams
) {
  const values: NewPaymentIntent = {
    id: crypto.randomUUID(),
    userId: params.userId,
    provider: params.provider,
    bizType: "credit_purchase",
    status: "created",
    displayMode: "redirect",
    packageId: params.packageId,
    credits: params.credits,
    amount: params.amount,
    currency: params.currency,
    subject: params.subject,
    outTradeNo: generateOutTradeNo({
      provider: params.provider,
      userId: params.userId,
    }),
    metadata: params.metadata ?? null,
    expiresAt: params.expiresAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const [created] = await db.insert(paymentIntent).values(values).returning();
  if (!created) {
    throw new Error("创建支付意图失败");
  }
  return created;
}

/**
 * 回写第三方下单结果。
 */
export async function updatePaymentIntentCheckout(
  params: UpdatePaymentIntentCheckoutParams
) {
  const [updated] = await db
    .update(paymentIntent)
    .set({
      displayMode: params.displayMode,
      checkoutUrl: params.checkoutUrl ?? null,
      qrCodeUrl: params.qrCodeUrl ?? null,
      providerOrderId: params.providerOrderId ?? null,
      providerCheckoutId: params.providerCheckoutId ?? null,
      providerPaymentId: params.providerPaymentId ?? null,
      providerResponse: params.providerResponse ?? null,
      expiresAt: params.expiresAt ?? null,
      status: params.status ?? "pending",
      updatedAt: new Date(),
    })
    .where(eq(paymentIntent.id, params.intentId))
    .returning();

  if (!updated) {
    throw new Error("更新支付意图失败");
  }
  return updated;
}

/**
 * 读取当前用户自己的支付意图。
 */
export async function getUserPaymentIntent(intentId: string, userId: string) {
  const [current] = await db
    .select()
    .from(paymentIntent)
    .where(
      and(eq(paymentIntent.id, intentId), eq(paymentIntent.userId, userId))
    )
    .limit(1);
  return current ?? null;
}

/**
 * 按商户订单号读取支付意图。
 */
export async function getPaymentIntentByOutTradeNo(outTradeNo: string) {
  const [current] = await db
    .select()
    .from(paymentIntent)
    .where(eq(paymentIntent.outTradeNo, outTradeNo))
    .limit(1);
  return current ?? null;
}

/**
 * 支付成功后将状态改为 paid。
 */
export async function markPaymentIntentPaid(
  params: MarkPaymentIntentPaidParams
) {
  const [updated] = await db
    .update(paymentIntent)
    .set({
      status: "paid",
      providerOrderId: params.providerOrderId ?? null,
      providerPaymentId: params.providerPaymentId ?? null,
      providerResponse: params.providerResponse ?? null,
      paidAt: params.paidAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentIntent.id, params.intentId))
    .returning();

  if (!updated) {
    throw new Error("回写支付成功状态失败");
  }
  return updated;
}

/**
 * 将支付意图标记为关闭或失败。
 */
export async function updatePaymentIntentStatus(
  intentId: string,
  status: Extract<PaymentIntentStatus, "closed" | "failed" | "refunded">
) {
  const [updated] = await db
    .update(paymentIntent)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(paymentIntent.id, intentId))
    .returning();
  return updated ?? null;
}

/**
 * 统一返回给前端的支付意图摘要。
 */
export function toPaymentIntentSummary(intent: PaymentIntent) {
  return {
    id: intent.id,
    provider: intent.provider,
    bizType: intent.bizType,
    status: intent.status,
    displayMode: intent.displayMode,
    packageId: intent.packageId,
    credits: intent.credits,
    amount: intent.amount,
    currency: intent.currency,
    subject: intent.subject,
    outTradeNo: intent.outTradeNo,
    checkoutUrl: intent.checkoutUrl,
    qrCodeUrl: intent.qrCodeUrl,
    expiresAt: intent.expiresAt,
    paidAt: intent.paidAt,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}
