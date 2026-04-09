import { NextResponse } from "next/server";
import { z } from "zod";

import { cleanupScopedStorageObjects } from "@/features/storage";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const cleanupScopeSchema = z
  .object({
    requestId: z.string().trim().min(1).max(120).optional(),
    taskId: z.string().trim().min(1).max(120).optional(),
    dryRun: z.boolean().default(false),
  })
  .refine((value) => value.requestId || value.taskId, {
    message: "requestId 或 taskId 至少需要提供一个",
    path: ["requestId"],
  });

/**
 * 校验管理员身份。
 */
async function requireAdmin(request: Request) {
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
  return null;
}

/**
 * 按 requestId 或 taskId 清理整组对象资源。
 */
export const POST = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const payload = cleanupScopeSchema.safeParse(await request.json());
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

  const result = await cleanupScopedStorageObjects({
    dryRun: payload.data.dryRun,
    ...(payload.data.requestId ? { requestId: payload.data.requestId } : {}),
    ...(payload.data.taskId ? { taskId: payload.data.taskId } : {}),
  });
  return NextResponse.json({
    success: true,
    ...result,
  });
});
