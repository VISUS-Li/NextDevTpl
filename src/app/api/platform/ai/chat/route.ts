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
      ...(payload.data.model ? { model: payload.data.model } : {}),
      ...(payload.data.temperature !== undefined
        ? { temperature: payload.data.temperature }
        : {}),
      ...(payload.data.metadata ? { metadata: payload.data.metadata } : {}),
    });

    if (payload.data.stream) {
      return createChatStreamResponse(result);
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

/**
 * 构造 SSE 响应。
 *
 * 当前阶段先输出标准流式协议，底层仍复用同步结算链路。
 */
function createChatStreamResponse(result: Awaited<ReturnType<typeof executeAIChat>>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({
            requestId: result.requestId,
            provider: result.provider,
            model: result.model,
          })}\n\n`
        )
      );
      controller.enqueue(
        encoder.encode(
          `event: message\ndata: ${JSON.stringify({
            content: result.content,
          })}\n\n`
        )
      );
      controller.enqueue(
        encoder.encode(
          `event: billing\ndata: ${JSON.stringify(result.billing)}\n\n`
        )
      );
      controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
