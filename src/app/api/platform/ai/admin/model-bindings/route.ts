import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createAIModelBinding,
  listAIModelBindings,
} from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const bindingSchema = z.object({
  providerId: z.string().trim().min(1),
  modelKey: z.string().trim().min(1).max(120),
  modelAlias: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100000).default(100),
  weight: z.number().int().min(1).max(100000).default(100),
  costMode: z.enum(["manual", "fixed"]).default("manual"),
  inputCostPer1k: z.number().int().min(0).default(0),
  outputCostPer1k: z.number().int().min(0).default(0),
  fixedCostUsd: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).max(10).default(0),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
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
 * 读取 Model Binding 列表。
 */
export const GET = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const bindings = await listAIModelBindings();
  return NextResponse.json({ success: true, bindings });
});

/**
 * 新增 Model Binding。
 */
export const POST = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const payload = bindingSchema.safeParse(await request.json());
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

  const binding = await createAIModelBinding(payload.data);
  return NextResponse.json({ success: true, binding }, { status: 201 });
});
