import { NextResponse } from "next/server";
import { z } from "zod";

import { AIGatewayError, executeAIChat } from "@/features/ai-gateway";
import {
  AccountFrozenError,
  InsufficientCreditsError,
} from "@/features/credits/core";
import {
  getRedinkTextFeatureKey,
  normalizeRedinkMessages,
  resolveRedinkUserModel,
} from "@/features/redink/service";
import { toolConfigProjectKeySchema } from "@/features/tool-config/schema";
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

const sceneSchema = z.enum([
  "title",
  "copywriting",
  "product_copy",
  "product_post_content",
]);

const textRequestSchema = z
  .object({
    projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
    scene: sceneSchema,
    messages: z.array(messageSchema).min(1).optional(),
    input: z
      .union([z.string().min(1), z.array(messageSchema).min(1)])
      .optional(),
    model: z.string().trim().min(1).max(120).optional(),
    temperature: z.number().min(0).max(2).optional(),
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
 * 执行 RedInk 文本生成代理。
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

  const payload = textRequestSchema.safeParse(await request.json());
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

  const messages = normalizeRedinkMessages(
    payload.data.messages,
    payload.data.input
  );
  const selectedModel = await resolveTextModel(
    payload.data.projectKey,
    session.user.id,
    payload.data.model
  );
  if (!selectedModel) {
    return NextResponse.json(
      {
        success: false,
        error: "model_not_allowed",
        message: "当前文本场景没有可用模型",
      },
      { status: 403 }
    );
  }

  try {
    const result = await executeAIChat({
      userId: session.user.id,
      toolKey: "redink",
      featureKey: getRedinkTextFeatureKey(payload.data.scene),
      projectKey: payload.data.projectKey,
      messages,
      model: selectedModel,
      ...(payload.data.temperature !== undefined
        ? { temperature: payload.data.temperature }
        : {}),
      metadata: {
        ...(payload.data.metadata ?? {}),
        projectKey: payload.data.projectKey,
        redinkScene: payload.data.scene,
        redinkModelGroup: "text_generation",
      },
    });

    return NextResponse.json({
      success: true,
      scene: payload.data.scene,
      modelGroup: "text_generation",
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
 * 校验文本场景允许使用的模型。
 */
async function resolveTextModel(
  projectKey: string,
  userId: string,
  requestedModel?: string
) {
  const resolved = await resolveRedinkUserModel(
    requestedModel
      ? {
          projectKey,
          userId,
          group: "text_generation",
          requestedModel,
        }
      : {
          projectKey,
          userId,
          group: "text_generation",
        }
  );

  if (!resolved.selectedModel) {
    return null;
  }

  return resolved.selectedModel;
}
