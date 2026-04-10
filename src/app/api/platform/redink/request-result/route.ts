import { NextResponse } from "next/server";
import { z } from "zod";

import { AIGatewayError } from "@/features/ai-gateway";
import {
  AccountFrozenError,
  InsufficientCreditsError,
} from "@/features/credits/core";
import { getRedinkAIChatResult } from "@/features/redink/service";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const querySchema = z.object({
  requestId: z.string().trim().min(1).max(120),
});

/**
 * 读取 RedInk 任务结果。
 */
export const GET = withApiLogging(async (request: Request) => {
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

  const url = new URL(request.url);
  const payload = querySchema.safeParse({
    requestId: url.searchParams.get("requestId") ?? "",
  });

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
    const result = await getRedinkAIChatResult({
      requestId: payload.data.requestId,
      userId: session.user.id,
    });

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error: "request_not_found",
          message: "RedInk 请求不存在",
        },
        { status: 404 }
      );
    }

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
