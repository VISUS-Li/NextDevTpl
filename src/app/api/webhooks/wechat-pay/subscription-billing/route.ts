import { NextResponse } from "next/server";

import { parseWechatRecurringBillingNotification } from "@/features/payment/recurring-provider-notify";
import {
  markSubscriptionBillingFailed,
  settleSubscriptionBillingPaid,
} from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { logError } from "@/lib/logger";

/**
 * 微信连续扣费账单回调。
 */
export const POST = withApiLogging(async (request: Request) => {
  try {
    const payload = await parseWechatRecurringBillingNotification(request);

    if (payload.status !== "paid") {
      const result = await markSubscriptionBillingFailed({
        outTradeNo: payload.outTradeNo,
        providerPaymentId: payload.providerPaymentId,
        failureReason: payload.failureReason ?? "wechat billing failed",
        rawResponse: payload.rawResponse,
      });
      return NextResponse.json({ success: true, result });
    }

    const result = await settleSubscriptionBillingPaid({
      outTradeNo: payload.outTradeNo,
      providerPaymentId: payload.providerPaymentId,
      paidAt: payload.paidAt ?? new Date(),
      eventType: payload.eventType,
      eventIdempotencyKey: payload.eventIdempotencyKey,
      rawResponse: payload.rawResponse,
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
