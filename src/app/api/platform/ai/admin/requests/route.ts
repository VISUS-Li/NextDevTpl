import { NextResponse } from "next/server";
import { z } from "zod";

import { listAIRequestLogs } from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z
    .enum(["pending", "success", "failed", "insufficient_credits", "billing_failed"])
    .optional(),
  toolKey: z.string().trim().min(1).max(100).optional(),
});

/**
 * 读取 AI 请求明细。
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
    limit: url.searchParams.get("limit") ?? "50",
    status: url.searchParams.get("status") ?? undefined,
    toolKey: url.searchParams.get("toolKey") ?? undefined,
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

  const requests = await listAIRequestLogs(query.data);
  return NextResponse.json({ success: true, requests });
});
