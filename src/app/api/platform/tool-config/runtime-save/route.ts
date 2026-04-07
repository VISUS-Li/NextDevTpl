import { NextResponse } from "next/server";

import { runtimeSaveToolConfigSchema } from "@/features/tool-config/schema";
import {
  saveUserToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config/service";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 供外部工具服务端写入用户工具配置
 */
export const POST = withApiLogging(async (request: Request) => {
  const unauthorizedResponse = assertRuntimeToken(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const payload = runtimeSaveToolConfigSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: payload.error.flatten() },
      { status: 400 }
    );
  }

  await seedDefaultToolConfigProject({ projectKey: payload.data.projectKey });
  const revision = await saveUserToolConfig({
    projectKey: payload.data.projectKey,
    toolKey: payload.data.tool,
    actorId: payload.data.userId,
    values: payload.data.values,
    clearSecrets: payload.data.clearSecrets,
  });

  return NextResponse.json(
    {
      success: true,
      revision,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
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
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 401 }
    );
  }

  return null;
}
