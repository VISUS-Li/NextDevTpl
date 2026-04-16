import { NextResponse } from "next/server";
import { z } from "zod";

import { runAIProviderHealthCheck } from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const healthCheckSchema = z.object({
  providerIds: z.array(z.string().trim().min(1)).optional(),
  disableOnFailure: z.boolean().default(false),
});

/**
 * 运行 Provider 健康检查。
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

  const payload = healthCheckSchema.safeParse(await request.json());
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

  const results = await runAIProviderHealthCheck(payload.data);
  return NextResponse.json({ success: true, results });
});
