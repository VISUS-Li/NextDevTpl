import { NextResponse } from "next/server";
import { z } from "zod";

import { createAIBillingAdjustment } from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const billingAdjustmentSchema = z.object({
  requestId: z.string().trim().min(1),
  direction: z.enum(["refund", "charge"]),
  credits: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
});

/**
 * 创建 AI 手工调账记录。
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

  const payload = billingAdjustmentSchema.safeParse(await request.json());
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

  const record = await createAIBillingAdjustment({
    ...payload.data,
    operatorUserId: session.user.id,
  });

  return NextResponse.json({ success: true, record }, { status: 201 });
});
