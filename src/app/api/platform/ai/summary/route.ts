import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import { getAIGatewayOverview, getAIProviderSummary } from "@/features/ai-gateway";

/**
 * AI 网关运营摘要接口。
 */
export const GET = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "unauthorized",
        message: "未登录",
      },
      { status: 401 }
    );
  }

  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json(
      {
        success: false,
        error: "forbidden",
        message: "无管理员权限",
      },
      { status: 403 }
    );
  }

  const [overview, providers] = await Promise.all([
    getAIGatewayOverview(),
    getAIProviderSummary(),
  ]);

  return NextResponse.json({
    success: true,
    overview,
    providers,
  });
});
