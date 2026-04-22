import { NextResponse } from "next/server";

import { settleSubscriptionBillingPaid } from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { logError } from "@/lib/logger";

/**
 * 微信连续扣费账单回调。
 */
export const POST = withApiLogging(async (request: Request) => {
  try {
    const payload = (await request.json()) as {
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      success_time?: string;
    };

    if (!payload.out_trade_no || payload.trade_state !== "SUCCESS") {
      return NextResponse.json(
        { success: false, error: "账单状态未成功" },
        { status: 400 }
      );
    }

    const result = await settleSubscriptionBillingPaid({
      outTradeNo: payload.out_trade_no,
      providerPaymentId: payload.transaction_id ?? null,
      paidAt: payload.success_time
        ? new Date(payload.success_time)
        : new Date(),
      eventType: "wechat.subscription.billing.paid",
      eventIdempotencyKey: `wechat_pay:subscription.billing:${payload.transaction_id ?? payload.out_trade_no}`,
      rawResponse: payload,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logError(error, { source: "wechat-pay-subscription-billing-webhook" });
    return NextResponse.json(
      { success: false, error: "账单回调处理失败" },
      { status: 500 }
    );
  }
});
