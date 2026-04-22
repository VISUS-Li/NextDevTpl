import { NextResponse } from "next/server";
import { z } from "zod";

import { refundCreditPurchasePayment } from "@/features/payment/refund-service";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const refundSchema = z.object({
  orderId: z.string().trim().min(1),
  amount: z.number().int().positive(),
  reason: z.string().trim().min(2).max(200),
});

/**
 * 管理员退款接口。
 */
export const POST = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "unauthorized", message: "未登录" },
      { status: 401 }
    );
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json(
      { success: false, error: "forbidden", message: "需要管理员权限" },
      { status: 403 }
    );
  }

  const payload = refundSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_request",
        message: "参数错误",
        details: payload.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    const result = await refundCreditPurchasePayment({
      ...payload.data,
      operatorUserId: session.user.id,
    });
    return NextResponse.json({ success: true, result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "退款失败";
    const status = message.includes("账户积分不足") ? 409 : 400;
    return NextResponse.json(
      { success: false, error: "refund_failed", message },
      { status }
    );
  }
});
