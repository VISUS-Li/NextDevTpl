import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import {
  AccountFrozenError,
  InsufficientCreditsError,
} from "@/features/credits/core";
import { AIGatewayError, executeAIChat } from "@/features/ai-gateway";

const chatRequestSchema = z.object({
  tool: z.string().trim().min(1).max(100),
  feature: z.string().trim().min(1).max(120),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1),
  stream: z.boolean().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  temperature: z.number().min(0).max(2).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 统一 AI Chat 接口。
 */
export const POST = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "unauthorized",
        message: "未登录",
      },
      { status: 401 }
    );
  }

  const payload = chatRequestSchema.safeParse(await request.json());
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

  try {
    const result = await executeAIChat({
      userId: session.user.id,
      toolKey: payload.data.tool,
      featureKey: payload.data.feature,
      messages: payload.data.messages,
      ...(payload.data.stream !== undefined
        ? { stream: payload.data.stream }
        : {}),
      ...(payload.data.model ? { model: payload.data.model } : {}),
      ...(payload.data.temperature !== undefined
        ? { temperature: payload.data.temperature }
        : {}),
      ...(payload.data.metadata ? { metadata: payload.data.metadata } : {}),
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof AIGatewayError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
        },
        { status: error.status }
      );
    }

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
