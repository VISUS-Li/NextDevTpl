import { NextResponse } from "next/server";

import { processDueSubscriptionBillings } from "@/features/payment/subscription-recurring";
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
 * 执行连续扣费定时扫描。
 */
export const POST = withApiLogging(async (request: Request) => {
  const authHeader = request.headers.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") || 20);

  try {
    const results = await processDueSubscriptionBillings({ limit });
    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process recurring billing",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
});

/**
 * 连续扣费定时任务健康检查。
 */
export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/payment/subscription-recurring",
    method: "POST",
    description: "Process due recurring subscription billings",
    authentication: "Bearer token required (CRON_SECRET)",
  });
});
