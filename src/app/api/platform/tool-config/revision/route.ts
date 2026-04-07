import { NextResponse } from "next/server";

import { getToolConfigRevision } from "@/features/tool-config/service";
import { toolConfigProjectKeySchema } from "@/features/tool-config/schema";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 读取工具配置版本号
 */
export const GET = withApiLogging(async (request: Request) => {
  const unauthorizedResponse = assertRuntimeToken(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const url = new URL(request.url);
  const projectKey = toolConfigProjectKeySchema.safeParse(
    url.searchParams.get("projectKey") ?? "nextdevtpl"
  );

  if (!projectKey.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: projectKey.error.flatten() },
      { status: 400 }
    );
  }

  const revision = await getToolConfigRevision(projectKey.data);

  return NextResponse.json({ success: true, revision });
});

function assertRuntimeToken(request: Request) {
  const token = process.env.TOOL_CONFIG_RUNTIME_TOKEN;
  if (!token) {
    return NextResponse.json(
      { success: false, error: "运行时配置令牌未设置" },
      { status: 503 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ success: false, error: "无权访问" }, { status: 401 });
  }

  return null;
}
