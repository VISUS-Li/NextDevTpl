import { NextResponse } from "next/server";

import { parseAlipayPaymentNotification } from "@/features/payment/provider-notify";
import { settleSuccessfulPaymentIntent } from "@/features/payment/settlement";
import { logError } from "@/lib/logger";

/**
 * 处理支付宝回调。
 */
export async function POST(request: Request) {
  try {
    const payment = await parseAlipayPaymentNotification(request);
    await settleSuccessfulPaymentIntent(payment);
    return new NextResponse("success", { status: 200 });
  } catch (error) {
    logError(error, { source: "alipay-webhook" });
    return new NextResponse(error instanceof Error ? error.message : "failed", {
      status: 400,
    });
  }
}
