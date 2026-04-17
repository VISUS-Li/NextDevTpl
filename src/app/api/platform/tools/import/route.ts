import { NextResponse } from "next/server";

import { importToolDefinition } from "@/features/tool-config/definition-admin";
import { importToolDefinitionSchema } from "@/features/tool-config/schema";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 导入工具定义。
 */
export const POST = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 403 }
    );
  }

  const payload = importToolDefinitionSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: payload.error.flatten() },
      { status: 400 }
    );
  }

  const result = await importToolDefinition({
    projectKey: payload.data.projectKey,
    actorId: session.user.id,
    definition: payload.data.definition,
  });

  return NextResponse.json({
    success: true,
    toolKey: result.tool?.toolKey ?? payload.data.definition.toolKey,
  });
});
