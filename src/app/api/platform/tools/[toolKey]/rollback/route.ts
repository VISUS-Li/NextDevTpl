import { NextResponse } from "next/server";

import { rollbackToolDefinition } from "@/features/tool-config/definition-admin";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 回滚工具定义。
 */
export const POST = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ toolKey: string }> }
  ) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "无权访问" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const { toolKey } = await context.params;
    await rollbackToolDefinition({
      toolKey,
      actorId: session.user.id,
      ...(url.searchParams.get("projectKey")
        ? { projectKey: url.searchParams.get("projectKey") ?? "" }
        : {}),
    });

    return NextResponse.json({
      success: true,
      toolKey,
    });
  }
);
