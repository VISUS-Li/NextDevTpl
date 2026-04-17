import { NextResponse } from "next/server";

import { createToolLaunchTicket } from "@/features/tool-config/runtime-auth";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 为外部工具创建启动票据。
 */
export const GET = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ toolKey: string }> }
  ) => {
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

    const url = new URL(request.url);
    const { toolKey } = await context.params;
    const launch = await createToolLaunchTicket({
      toolKey,
      userId: session.user.id,
      ...(url.searchParams.get("projectKey")
        ? { projectKey: url.searchParams.get("projectKey") ?? "" }
        : {}),
    });

    return NextResponse.json({
      success: true,
      tool: toolKey,
      ticket: launch.ticket,
      launchUrl: launch.launchUrl,
      expiresAt: launch.expiresAt,
    });
  }
);
