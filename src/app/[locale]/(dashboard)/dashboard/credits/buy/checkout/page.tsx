import { notFound } from "next/navigation";

import { CheckoutPaymentIntentView } from "./payment-intent-view";

/**
 * 积分购买收银台页。
 */
export default async function BuyCreditsCheckoutPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const intentId = Array.isArray(resolvedParams.intentId)
    ? resolvedParams.intentId[0]
    : resolvedParams.intentId;

  if (!intentId) {
    notFound();
  }

  return <CheckoutPaymentIntentView intentId={intentId} />;
}
