import { NextResponse } from "next/server";

import {
  getToolConfigEditorData,
  seedDefaultToolConfigProject,
} from "@/features/tool-config/service";
import { toolConfigEditorQuerySchema } from "@/features/tool-config/schema";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 读取工具页面配置表单数据
 */
export const GET = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const url = new URL(request.url);
  const payload = toolConfigEditorQuerySchema.safeParse({
    projectKey: url.searchParams.get("projectKey") ?? undefined,
    tool: url.searchParams.get("tool") ?? "",
  });

  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: payload.error.flatten() },
      { status: 400 }
    );
  }

  await seedDefaultToolConfigProject({ projectKey: payload.data.projectKey });
  const editor = await getToolConfigEditorData({
    projectKey: payload.data.projectKey,
    toolKey: payload.data.tool,
    userId: session.user.id,
    mode: "user",
  });

  return NextResponse.json({ success: true, ...editor });
});
