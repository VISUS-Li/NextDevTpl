import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { cleanupExpiredStorageObjects } from "@/features/storage/records";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 校验 Cron Bearer Token。
 */
function validateCronSecret(authHeader: string | null) {
  if (!authHeader) {
    return false;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  return token === cronSecret;
}

/**
 * 执行对象存储过期清理。
 */
export const POST = withApiLogging(async () => {
  const headerList = await headers();
  const authHeader = headerList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupExpiredStorageObjects({
      limit: 200,
      dryRun: false,
    });

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to cleanup storage objects",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
});

/**
 * 清理任务健康检查。
 */
export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/storage/cleanup",
    method: "POST",
    description: "Cleanup expired storage objects",
    authentication: "Bearer token required (CRON_SECRET)",
  });
});
