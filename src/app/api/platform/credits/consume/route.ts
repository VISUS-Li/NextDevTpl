import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import {
  AccountFrozenError,
  consumeCredits,
  ensureRegistrationBonus,
  InsufficientCreditsError,
} from "@/features/credits/core";
import {
  CREDITS_EXPIRY_DAYS,
  REGISTRATION_BONUS_CREDITS,
} from "@/features/credits/config";

const consumeCreditsSchema = z.object({
  amount: z.number().int().positive(),
  serviceName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 消费积分
 *
 * 给外部工具提供统一的按次扣费入口。
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

  const payload = consumeCreditsSchema.safeParse(await request.json());
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

  try {
    const result = await consumeCredits({
      userId: session.user.id,
      amount: payload.data.amount,
      serviceName: payload.data.serviceName,
      ...(payload.data.description
        ? { description: payload.data.description }
        : {}),
      ...(payload.data.metadata ? { metadata: payload.data.metadata } : {}),
    });

    return NextResponse.json({
      success: true,
      consumedAmount: result.consumedAmount,
      remainingBalance: result.remainingBalance,
      transactionId: result.transactionId,
      consumedBatches: result.consumedBatches,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          success: false,
          error: "insufficient_credits",
          message: error.message,
          required: error.required,
          available: error.available,
        },
        { status: 409 }
      );
    }

    if (error instanceof AccountFrozenError) {
      return NextResponse.json(
        {
          success: false,
          error: "account_frozen",
          message: error.message,
        },
        { status: 409 }
      );
    }

    throw error;
  }
});
