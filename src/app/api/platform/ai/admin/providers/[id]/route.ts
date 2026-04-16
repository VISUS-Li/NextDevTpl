import { NextResponse } from "next/server";
import { z } from "zod";

import { updateAIProvider, deleteAIProvider } from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const providerUpdateSchema = z.object({
  key: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  weight: z.number().int().min(1).max(100000).optional(),
  requestType: z.literal("chat").optional(),
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
 * 更新 Provider。
 */
export const PATCH = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const denied = await requireAdmin(request);
    if (denied) return denied;

    const payload = providerUpdateSchema.safeParse(await request.json());
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

    const { id } = await context.params;
    const provider = await updateAIProvider(id, payload.data);
    return NextResponse.json({ success: true, provider });
  }
);

/**
 * 删除 Provider。
 */
export const DELETE = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const denied = await requireAdmin(request);
    if (denied) return denied;

    const { id } = await context.params;
    await deleteAIProvider(id);
    return NextResponse.json({ success: true });
  }
);
