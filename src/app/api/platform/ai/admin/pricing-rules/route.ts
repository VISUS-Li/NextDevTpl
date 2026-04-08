import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createAIPricingRule,
  listAIPricingRules,
} from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const pricingRuleSchema = z.object({
  toolKey: z.string().trim().min(1).max(100),
  featureKey: z.string().trim().min(1).max(120),
  requestType: z.literal("chat").default("chat"),
  billingMode: z.enum(["fixed_credits", "token_based", "cost_plus"]),
  modelScope: z.string().trim().min(1).max(120).default("any"),
  fixedCredits: z.number().int().min(0).nullable().default(null),
  inputTokensPerCredit: z.number().int().min(1).nullable().default(null),
  outputTokensPerCredit: z.number().int().min(1).nullable().default(null),
  costUsdPerCredit: z.number().int().min(1).nullable().default(null),
  minimumCredits: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
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
 * 读取计费规则列表。
 */
export const GET = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const pricingRules = await listAIPricingRules();
  return NextResponse.json({ success: true, pricingRules });
});

/**
 * 新增计费规则。
 */
export const POST = withApiLogging(async (request: Request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const payload = pricingRuleSchema.safeParse(await request.json());
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

  const pricingRule = await createAIPricingRule(payload.data);
  return NextResponse.json({ success: true, pricingRule }, { status: 201 });
});
