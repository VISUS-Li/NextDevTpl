import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import { createAIProvider, listAIProviders } from "@/features/ai-gateway/admin";

const providerSchema = z.object({
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100000).default(100),
  weight: z.number().int().min(1).max(100000).default(100),
  requestType: z.literal("chat").default("chat"),
});

/**
 * 校验管理员身份。
 */
async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "unauthorized", message: "未登录" },
      { status: 401 }
    );
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json(
      { success: false, error: "forbidden", message: "需要管理员权限" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * 读取 Provider 列表。
 */
export const GET = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const providers = await listAIProviders();
  return NextResponse.json({ success: true, providers });
});

/**
 * 新增 Provider。
 */
export const POST = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const payload = providerSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_request",
        message: "参数错误",
        details: payload.error.flatten(),
      },
      { status: 400 }
    );
  }

  const provider = await createAIProvider(payload.data);
  return NextResponse.json({ success: true, provider }, { status: 201 });
});
