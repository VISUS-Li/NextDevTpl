import { NextResponse } from "next/server";
import { z } from "zod";

import { getAIOperationAlerts } from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const querySchema = z.object({
  costAlertMicros: z.coerce.number().int().min(1).optional(),
  failureRateThreshold: z.coerce.number().min(0).max(1).optional(),
});

/**
 * 读取 AI 运维告警。
 */
export const GET = withApiLogging(async (request: Request) => {
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

  const url = new URL(request.url);
  const query = querySchema.safeParse({
    costAlertMicros: url.searchParams.get("costAlertMicros") ?? undefined,
    failureRateThreshold: url.searchParams.get("failureRateThreshold") ?? undefined,
  });

  if (!query.success) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_request",
        message: "参数错误",
        details: query.error.flatten(),
      },
      { status: 400 }
    );
  }

  const alerts = await getAIOperationAlerts(query.data);
  return NextResponse.json({ success: true, alerts });
});
