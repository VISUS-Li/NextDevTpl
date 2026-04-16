import { NextResponse } from "next/server";
import { z } from "zod";

import { applyGeekPreset } from "@/features/ai-gateway";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const modelSchema = z.object({
  modelKey: z.string().trim().min(1).max(120),
  modelAlias: z.string().trim().min(1).max(120),
  tier: z.enum(["cheap", "standard", "premium"]).default("standard"),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

const pricingRuleSchema = z.object({
  toolKey: z.string().trim().min(1).max(100),
  featureKey: z.string().trim().min(1).max(120),
  profile: z
    .enum([
      "text_basic",
      "text_long",
      "multimodal_basic",
      "multimodal_heavy",
      "async_media",
    ])
    .default("text_basic"),
  modelScope: z.string().trim().min(1).max(120).optional(),
});

const geekPresetSchema = z.object({
  apiKey: z.string().trim().min(1).max(500),
  providerKey: z.string().trim().min(1).max(120).default("geek-default"),
  providerName: z.string().trim().min(1).max(120).default("Geek Default"),
  baseUrl: z.string().trim().url().default("https://geekai.co/api/v1"),
  models: z
    .array(modelSchema)
    .min(1)
    .default([
      {
        modelKey: "gpt-5-mini",
        modelAlias: "gpt-5-mini",
        tier: "standard",
        timeoutMs: 45000,
      },
    ]),
  pricingRules: z
    .array(pricingRuleSchema)
    .min(1)
    .default([
      {
        toolKey: "redink",
        featureKey: "rewrite",
        profile: "text_basic",
      },
    ]),
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
 * 应用 Geek 预设配置。
 */
export const POST = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const payload = geekPresetSchema.safeParse(await request.json());
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

  const result = await applyGeekPreset(payload.data);
  return NextResponse.json({ success: true, ...result }, { status: 201 });
});
