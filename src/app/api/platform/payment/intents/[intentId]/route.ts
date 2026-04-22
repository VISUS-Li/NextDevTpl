import { NextResponse } from "next/server";

import {
  getUserPaymentIntent,
  toPaymentIntentSummary,
} from "@/features/payment/payment-intents";
import { auth } from "@/lib/auth";

/**
 * 读取当前登录用户的支付意图详情。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ intentId: string }> }
) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "未登录",
      },
      { status: 401 }
    );
  }

  const { intentId } = await context.params;
  const intent = await getUserPaymentIntent(intentId, session.user.id);
  if (!intent) {
    return NextResponse.json(
      {
        success: false,
        error: "支付单不存在",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    intent: toPaymentIntentSummary(intent),
  });
}
