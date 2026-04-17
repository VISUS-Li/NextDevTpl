import { NextResponse } from "next/server";

import { listAdminToolDefinitions } from "@/features/tool-config/definition-admin";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 返回后台工具状态列表。
 */
export const GET = withApiLogging(async (request: Request) => {
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
  const data = await listAdminToolDefinitions(
    url.searchParams.get("projectKey") ?? undefined
  );

  return NextResponse.json({
    success: true,
    project: {
      key: data.project.key,
      name: data.project.name,
      revision: data.project.configRevision,
    },
    tools: data.tools,
  });
});
