import { NextResponse } from "next/server";
import {
  readBearerToken,
  verifyToolRuntimeToken,
} from "@/features/tool-config/runtime-auth";
import {
  toolConfigProjectKeySchema,
  toolConfigToolKeySchema,
} from "@/features/tool-config/schema";
import { getToolConfigRevision } from "@/features/tool-config/service";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 读取工具配置版本号
 */
export const GET = withApiLogging(async (request: Request) => {
  const url = new URL(request.url);
  const projectKey = toolConfigProjectKeySchema.safeParse(
    url.searchParams.get("projectKey") ?? "nextdevtpl"
  );
  const toolKey = toolConfigToolKeySchema.safeParse(
    url.searchParams.get("tool")
  );

  if (!projectKey.success || !toolKey.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
        details: {
          projectKey: projectKey.success ? null : projectKey.error.flatten(),
          tool: toolKey.success ? null : toolKey.error.flatten(),
        },
      },
      { status: 400 }
    );
  }

  const unauthorizedResponse = await assertRuntimeToken(
    request,
    projectKey.data,
    toolKey.data
  );
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const revision = await getToolConfigRevision(projectKey.data);

  return NextResponse.json({ success: true, revision });
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
