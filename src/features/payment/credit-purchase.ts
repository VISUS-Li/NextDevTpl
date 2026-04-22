import {
  CREDIT_PACKAGES,
  type CreditPackageId,
} from "@/features/credits/config";
import { buildCheckoutAttributionMetadata } from "@/features/distribution/attribution";
import {
  createCreditPurchasePaymentIntent,
  toPaymentIntentSummary,
  updatePaymentIntentCheckout,
} from "@/features/payment/payment-intents";
import { createProviderCheckout } from "@/features/payment/provider-service";
import { PaymentProvider } from "@/features/payment/types";

/**
 * 创建积分购买支付单的入参。
 */
type CreateCreditPurchaseParams = {
  userId: string;
  provider: PaymentProvider;
  packageId: CreditPackageId;
  baseUrl: string;
  userAgent?: string | null;
  userIp?: string | null;
};

/**
 * 创建积分购买支付意图，并调用对应渠道生成支付参数。
 */
export async function createCreditPurchaseCheckoutIntent(
  params: CreateCreditPurchaseParams
) {
  const pkg = CREDIT_PACKAGES.find((item) => item.id === params.packageId);
  if (!pkg) {
    throw new Error("无效的积分套餐");
  }

  // 积分购买沿用分销归因，避免新支付渠道绕开现有佣金链路。
  const attributionMetadata = await buildCheckoutAttributionMetadata(
    params.userId
  );
  const intent = await createCreditPurchasePaymentIntent({
    userId: params.userId,
    provider: params.provider,
    packageId: pkg.id,
    credits: pkg.credits,
    amount: pkg.price * 100,
    currency: params.provider === PaymentProvider.CREEM ? "USD" : "CNY",
    subject: `购买 ${pkg.credits} 积分`,
    metadata: {
      packageName: pkg.name,
      packageDescription: pkg.description,
      ...attributionMetadata,
    },
  });
  const checkout = await createProviderCheckout({
    intent,
    baseUrl: params.baseUrl,
    userAgent: params.userAgent,
    userIp: params.userIp,
  });
  const updatedIntent = await updatePaymentIntentCheckout({
    intentId: intent.id,
    displayMode: checkout.displayMode,
    checkoutUrl: checkout.checkoutUrl,
    qrCodeUrl: checkout.qrCodeUrl,
    providerOrderId: checkout.providerOrderId,
    providerCheckoutId: checkout.providerCheckoutId,
    providerPaymentId: checkout.providerPaymentId,
    providerResponse: checkout.rawResponse ?? null,
    expiresAt: checkout.expiresAt ?? null,
  });

  return {
    intent: updatedIntent,
    summary: toPaymentIntentSummary(updatedIntent),
    redirectUrl: `${params.baseUrl}/dashboard/credits/buy/checkout?intentId=${updatedIntent.id}`,
  };
}
