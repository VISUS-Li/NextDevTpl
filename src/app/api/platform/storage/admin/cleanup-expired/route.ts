import { NextResponse } from "next/server";
import { z } from "zod";

import { cleanupExpiredStorageObjects } from "@/features/storage/records";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const cleanupExpiredSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  dryRun: z.boolean().default(false),
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
 * 清理已过期的对象存储资源。
 */
export const POST = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const payload = cleanupExpiredSchema.safeParse(await request.json());
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

  const result = await cleanupExpiredStorageObjects(payload.data);
  return NextResponse.json({
    success: true,
    ...result,
  });
});
