import { NextResponse } from "next/server";
import { z } from "zod";
import { AIGatewayError, executeAIChat } from "@/features/ai-gateway";
import {
  AccountFrozenError,
  InsufficientCreditsError,
} from "@/features/credits/core";
import type { AIChatMessage, AIInputPart } from "@/lib/ai";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().trim().min(1),
});

const imageUrlPartSchema = z.object({
  type: z.literal("image_url"),
  imageUrl: z.string().url(),
  detail: z.enum(["auto", "low", "high"]).optional(),
});

const imageAssetPartSchema = z.object({
  type: z.literal("image_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
  detail: z.enum(["auto", "low", "high"]).optional(),
});

const audioUrlPartSchema = z.object({
  type: z.literal("audio_url"),
  audioUrl: z.string().url(),
  format: z.string().trim().min(1).max(40).optional(),
});

const audioAssetPartSchema = z.object({
  type: z.literal("audio_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
  format: z.string().trim().min(1).max(40).optional(),
});

const videoUrlPartSchema = z.object({
  type: z.literal("video_url"),
  videoUrl: z.string().url(),
});

const videoAssetPartSchema = z.object({
  type: z.literal("video_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
});

const fileAssetPartSchema = z.object({
  type: z.literal("file_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
  filename: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
});

const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  imageUrlPartSchema,
  imageAssetPartSchema,
  audioUrlPartSchema,
  audioAssetPartSchema,
  videoUrlPartSchema,
  videoAssetPartSchema,
  fileAssetPartSchema,
]);

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string().min(1), z.array(messagePartSchema).min(1)]),
});

const chatRequestSchema = z
  .object({
    tool: z.string().trim().min(1).max(100),
    feature: z.string().trim().min(1).max(120),
    messages: z.array(messageSchema).min(1).optional(),
    input: z
      .union([z.string().min(1), z.array(messageSchema).min(1)])
      .optional(),
    stream: z.boolean().optional(),
    model: z.string().trim().min(1).max(120).optional(),
    temperature: z.number().min(0).max(2).optional(),
    modalities: z
      .array(z.enum(["text", "image", "audio", "video"]))
      .min(1)
      .optional(),
    audio: z.record(z.string(), z.unknown()).optional(),
    image: z.record(z.string(), z.unknown()).optional(),
    background: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.messages && !value.input) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages"],
        message: "messages 或 input 至少需要提供一个",
      });
    }
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
    const normalizedMessages = normalizeRequestMessages(
      payload.data.messages,
      payload.data.input
    );
    const result = await executeAIChat({
      userId: session.user.id,
      toolKey: payload.data.tool,
      featureKey: payload.data.feature,
      messages: normalizedMessages,
      ...(payload.data.model ? { model: payload.data.model } : {}),
      ...(payload.data.temperature !== undefined
        ? { temperature: payload.data.temperature }
        : {}),
      ...(payload.data.modalities
        ? { modalities: payload.data.modalities }
        : {}),
      ...(payload.data.audio ? { audio: payload.data.audio } : {}),
      ...(payload.data.image ? { image: payload.data.image } : {}),
      ...(payload.data.background !== undefined
        ? { background: payload.data.background }
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
function createChatStreamResponse(
  result: Awaited<ReturnType<typeof executeAIChat>>
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({
            requestId: result.requestId,
            provider: result.provider,
            model: result.model,
            status: result.status,
          })}\n\n`
        )
      );
      controller.enqueue(
        encoder.encode(
          `event: message\ndata: ${JSON.stringify({
            content: result.content,
            output: result.output,
            task: result.task,
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

/**
 * 统一处理 messages / input 两种输入风格。
 */
function normalizeRequestMessages(
  messages: AIChatMessage[] | undefined,
  input: string | AIChatMessage[] | undefined
): AIChatMessage[] {
  if (messages?.length) {
    return messages.map(normalizeMessage);
  }
  if (typeof input === "string") {
    return [
      {
        role: "user",
        content: input.trim(),
      },
    ];
  }
  if (input?.length) {
    return input.map(normalizeMessage);
  }
  return [];
}

/**
 * 归一化消息内容，去掉空白并保持统一结构。
 */
function normalizeMessage(message: AIChatMessage): AIChatMessage {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content.trim(),
    };
  }

  return {
    role: message.role,
    content: message.content.map(normalizePart),
  };
}

/**
 * 归一化多模态片段。
 */
function normalizePart(part: AIInputPart): AIInputPart {
  if (part.type === "text") {
    return {
      ...part,
      text: part.text.trim(),
    };
  }

  if ("bucket" in part && "key" in part) {
    return {
      ...part,
      bucket: part.bucket.trim(),
      key: part.key.trim(),
    };
  }

  return part;
}
