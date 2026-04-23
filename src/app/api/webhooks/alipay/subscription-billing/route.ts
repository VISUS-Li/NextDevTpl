import { NextResponse } from "next/server";

import { settleSubscriptionBillingPaid } from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { logError } from "@/lib/logger";

/**
 * 支付宝代扣账单回调。
 */
export const POST = withApiLogging(async (request: Request) => {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? ((await request.json()) as Record<string, string>)
      : (Object.fromEntries((await request.formData()).entries()) as Record<
          string,
          string
        >);

    const tradeStatus = payload.trade_status ?? "";
    if (
      !payload.out_trade_no ||
      !["TRADE_SUCCESS", "TRADE_FINISHED"].includes(tradeStatus)
    ) {
      return NextResponse.json(
        { success: false, error: "账单状态未成功" },
        { status: 400 }
      );
    }

    const result = await settleSubscriptionBillingPaid({
      outTradeNo: payload.out_trade_no,
      providerPaymentId: payload.trade_no ?? null,
      paidAt: payload.gmt_payment ? new Date(payload.gmt_payment) : new Date(),
      eventType: "alipay.subscription.billing.paid",
      eventIdempotencyKey: `alipay:subscription.billing:${payload.trade_no ?? payload.out_trade_no}`,
      rawResponse: payload,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logError(error, { source: "alipay-subscription-billing-webhook" });
    return NextResponse.json(
      { success: false, error: "账单回调处理失败" },
      { status: 500 }
    );
  }
});
