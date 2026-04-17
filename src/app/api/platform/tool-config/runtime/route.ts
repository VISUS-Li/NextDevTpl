import { NextResponse } from "next/server";
import {
  readBearerToken,
  verifyToolRuntimeToken,
} from "@/features/tool-config/runtime-auth";
import { runtimeToolConfigSchema } from "@/features/tool-config/schema";
import { getResolvedToolConfig } from "@/features/tool-config/service";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 读取服务端工具运行配置
 */
export const POST = withApiLogging(async (request: Request) => {
  const payload = runtimeToolConfigSchema.safeParse(await request.json());
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

  const resolved = await getResolvedToolConfig({
    projectKey: payload.data.projectKey,
    toolKey: payload.data.tool,
    userId: payload.data.userId,
  });
  const changed = payload.data.knownRevision !== resolved.revision;

  return NextResponse.json(
    {
      success: true,
      revision: resolved.revision,
      changed,
      ...(changed ? { config: resolved.config } : {}),
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
    scope: "runtime:read",
  });

  if (!runtimeToken) {
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 401 }
    );
  }

  return null;
}
