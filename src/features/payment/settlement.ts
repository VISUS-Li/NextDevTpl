import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { creditsBatch } from "@/db/schema";
import { CREDITS_EXPIRY_DAYS } from "@/features/credits/config";
import { grantCredits } from "@/features/credits/core";
import { settleCommissionForSalesOrder } from "@/features/distribution/commission";
import { upsertSalesOrderFromPaymentIntent } from "@/features/distribution/orders";
import {
  getPaymentIntentByOutTradeNo,
  markPaymentIntentPaid,
} from "@/features/payment/payment-intents";
import { logger } from "@/lib/logger";

type SettleSuccessfulPaymentParams = {
  outTradeNo: string;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  providerResponse?: Record<string, unknown> | null;
  eventType: string;
  eventIdempotencyKey: string;
  paidAt?: Date;
};

/**
 * 将三方支付成功回写到本地业务单。
 */
export async function settleSuccessfulPaymentIntent(
  params: SettleSuccessfulPaymentParams
) {
  const intent = await getPaymentIntentByOutTradeNo(params.outTradeNo);
  if (!intent) {
    return null;
  }

  const paidIntent =
    intent.status === "paid"
      ? intent
      : await markPaymentIntentPaid({
          intentId: intent.id,
          providerOrderId: params.providerOrderId,
          providerPaymentId: params.providerPaymentId,
          providerResponse: params.providerResponse ?? null,
          paidAt: params.paidAt,
        });

  const paymentRef =
    params.providerPaymentId ??
    params.providerOrderId ??
    paidIntent.providerPaymentId ??
    paidIntent.providerOrderId ??
    paidIntent.outTradeNo;

  const salesOrderId = await upsertSalesOrderFromPaymentIntent({
    intent: paidIntent,
    eventType: params.eventType,
    eventIdempotencyKey: params.eventIdempotencyKey,
    providerOrderId: params.providerOrderId ?? null,
    providerPaymentId: paymentRef,
    paidAt: params.paidAt,
    metadata: params.providerResponse ?? null,
  });

  await grantCreditPurchaseIfNeeded({
    userId: paidIntent.userId,
    paymentRef,
    credits: paidIntent.credits,
    packageId: paidIntent.packageId,
    intentId: paidIntent.id,
    provider: paidIntent.provider,
    outTradeNo: paidIntent.outTradeNo,
  });

  await settleCommissionForSalesOrder(salesOrderId, "credit_purchase");

  logger.info(
    {
      event: "payment.intent.paid",
      paymentIntentId: paidIntent.id,
      outTradeNo: paidIntent.outTradeNo,
      provider: paidIntent.provider,
      salesOrderId,
      paymentRef,
    },
    "Payment intent settled"
  );

  return {
    intent: paidIntent,
    salesOrderId,
  };
}

/**
 * 积分购买按 paymentRef 做幂等发放。
 */
async function grantCreditPurchaseIfNeeded(params: {
  userId: string;
  paymentRef: string;
  credits: number;
  packageId: string;
  intentId: string;
  provider: string;
  outTradeNo: string;
}) {
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceType, "purchase"),
        eq(creditsBatch.sourceRef, params.paymentRef)
      )
    )
    .limit(1);

  if (existingBatch) {
    return existingBatch.id;
  }

  const expiresAt = CREDITS_EXPIRY_DAYS
    ? new Date(Date.now() + CREDITS_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    : null;

  const granted = await grantCredits({
    userId: params.userId,
    amount: params.credits,
    sourceType: "purchase",
    debitAccount: `PAYMENT:${params.paymentRef}`,
    transactionType: "purchase",
    expiresAt,
    sourceRef: params.paymentRef,
    description: `购买 ${params.credits} 积分 (${params.packageId})`,
    metadata: {
      paymentIntentId: params.intentId,
      provider: params.provider,
      outTradeNo: params.outTradeNo,
      packageId: params.packageId,
    },
  });

  return granted.batchId;
}
