import { NextResponse } from "next/server";

import {
  buildWechatNotifySuccessResponse,
  parseWechatPaymentNotification,
} from "@/features/payment/provider-notify";
import { settleSuccessfulPaymentIntent } from "@/features/payment/settlement";
import { logError } from "@/lib/logger";

/**
 * 处理微信支付回调。
 */
export async function POST(request: Request) {
  try {
    const payment = await parseWechatPaymentNotification(request);
    await settleSuccessfulPaymentIntent(payment);
    return NextResponse.json(buildWechatNotifySuccessResponse());
  } catch (error) {
    logError(error, { source: "wechat-pay-webhook" });
    return NextResponse.json(
      {
        code: "FAIL",
        message: error instanceof Error ? error.message : "处理失败",
      },
      { status: 400 }
    );
  }
}
