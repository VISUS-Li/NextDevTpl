import { NextResponse } from "next/server";
import { z } from "zod";

import {
  exchangeToolLaunchTicket,
  readBearerToken,
  verifyToolRuntimeToken,
} from "@/features/tool-config/runtime-auth";
import { withApiLogging } from "@/lib/api-logger";

const exchangeSchema = z.object({
  projectKey: z.string().trim().min(1).max(80).default("nextdevtpl"),
  tool: z.string().trim().min(1).max(80),
  ticket: z.string().trim().min(1).max(255),
});

/**
 * 用工具票据交换平台用户身份。
 */
export const POST = withApiLogging(async (request: Request) => {
  const payload = exchangeSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: payload.error.flatten() },
      { status: 400 }
    );
  }

  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 401 }
    );
  }
  const runtimeToken = await verifyToolRuntimeToken({
    projectKey: payload.data.projectKey,
    toolKey: payload.data.tool,
    token,
    scope: "session:exchange",
  });

  if (!runtimeToken) {
    return NextResponse.json(
      { success: false, error: "无权访问" },
      { status: 401 }
    );
  }

  const exchanged = await exchangeToolLaunchTicket({
    projectKey: payload.data.projectKey,
    toolKey: payload.data.tool,
    ticket: payload.data.ticket,
  });

  if (!exchanged) {
    return NextResponse.json(
      { success: false, error: "票据无效或已过期" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    toolKey: exchanged.toolKey,
    user: exchanged.user,
    expiresAt: exchanged.expiresAt,
  });
});
