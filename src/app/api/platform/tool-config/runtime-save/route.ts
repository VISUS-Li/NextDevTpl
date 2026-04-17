import { NextResponse } from "next/server";
import {
  readBearerToken,
  verifyToolRuntimeToken,
} from "@/features/tool-config/runtime-auth";
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
  const payload = runtimeSaveToolConfigSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: payload.error.flatten() },
      { status: 400 }
    );
  }

  const unauthorizedResponse = await assertRuntimeToken(
    request,
    payload.data.projectKey,
    payload.data.tool
  );
  if (unauthorizedResponse) {
    return unauthorizedResponse;
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

async function assertRuntimeToken(
  request: Request,
  projectKey: string,
  toolKey: string
) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 401 }
    );
  }
  const runtimeToken = await verifyToolRuntimeToken({
    projectKey,
    toolKey,
    token,
    scope: "runtime:write",
  });

  if (!runtimeToken) {
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 401 }
    );
  }

  return null;
}
