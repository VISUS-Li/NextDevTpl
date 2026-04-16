import { NextResponse } from "next/server";

import { saveUserToolConfigSchema } from "@/features/tool-config/schema";
import {
  saveUserToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config/service";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 保存工具页面中的用户配置
 */
export const POST = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const payload = saveUserToolConfigSchema.safeParse(await request.json());
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
    actorId: session.user.id,
    values: payload.data.values,
    clearSecrets: payload.data.clearSecrets,
  });

  return NextResponse.json({ success: true, revision });
});
