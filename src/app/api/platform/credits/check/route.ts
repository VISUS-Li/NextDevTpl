import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import {
  CREDITS_EXPIRY_DAYS,
  REGISTRATION_BONUS_CREDITS,
} from "@/features/credits/config";
import {
  ensureRegistrationBonus,
  getCreditsBalance,
} from "@/features/credits/core";

const checkCreditsSchema = z.object({
  amount: z.number().int().positive(),
});

/**
 * 检查当前用户积分是否足够
 */
export const POST = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "未登录",
      },
      { status: 401 }
    );
  }

  const payload = checkCreditsSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
        details: payload.error.flatten(),
      },
      { status: 400 }
    );
  }

  await ensureRegistrationBonus(
    session.user.id,
    REGISTRATION_BONUS_CREDITS,
    CREDITS_EXPIRY_DAYS
  );

  const balance = await getCreditsBalance(session.user.id);
  return NextResponse.json({
    success: true,
    available: balance.balance >= payload.data.amount && balance.status === "active",
    required: payload.data.amount,
    currentBalance: balance.balance,
    status: balance.status,
  });
});
