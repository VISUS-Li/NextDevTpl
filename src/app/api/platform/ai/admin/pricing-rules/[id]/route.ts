import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteAIPricingRule,
  updateAIPricingRule,
} from "@/features/ai-gateway/admin";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const pricingRuleUpdateSchema = z.object({
  toolKey: z.string().trim().min(1).max(100).optional(),
  featureKey: z.string().trim().min(1).max(120).optional(),
  requestType: z.literal("chat").optional(),
  billingMode: z.enum(["fixed_credits", "token_based", "cost_plus"]).optional(),
  modelScope: z.string().trim().min(1).max(120).optional(),
  fixedCredits: z.number().int().min(0).nullable().optional(),
  inputTokensPerCredit: z.number().int().min(1).nullable().optional(),
  outputTokensPerCredit: z.number().int().min(1).nullable().optional(),
  costUsdPerCredit: z.number().int().min(1).nullable().optional(),
  minimumCredits: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
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
 * 更新计费规则。
 */
export const PATCH = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const denied = await requireAdmin(request);
    if (denied) return denied;

    const payload = pricingRuleUpdateSchema.safeParse(await request.json());
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
    const pricingRule = await updateAIPricingRule(id, payload.data);
    return NextResponse.json({ success: true, pricingRule });
  }
);

/**
 * 删除计费规则。
 */
export const DELETE = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const denied = await requireAdmin(request);
    if (denied) return denied;

    const { id } = await context.params;
    await deleteAIPricingRule(id);
    return NextResponse.json({ success: true });
  }
);
