import { NextResponse } from "next/server";
import { z } from "zod";

import { AIGatewayError, executeAIChat } from "@/features/ai-gateway";
import {
  AccountFrozenError,
  InsufficientCreditsError,
} from "@/features/credits/core";
import {
  redinkInputSchema,
  redinkMessageSchema,
} from "@/features/redink/request-schema";
import {
  getRedinkImageFeatureKey,
  normalizeRedinkMessages,
  resolveRedinkUserModel,
} from "@/features/redink/service";
import { toolConfigProjectKeySchema } from "@/features/tool-config/schema";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const sceneSchema = z.enum(["product_post_image", "general_image"]);

const imageRequestSchema = z
  .object({
    projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
    scene: sceneSchema,
    messages: z.array(redinkMessageSchema).min(1).optional(),
    input: redinkInputSchema.optional(),
    model: z.string().trim().min(1).max(120).optional(),
    operation: z.enum(["image.generate", "image.edit"]).optional(),
    image: z.record(z.string(), z.unknown()).optional(),
    background: z
      .union([z.boolean(), z.enum(["transparent", "opaque", "auto"])])
      .optional(),
    async: z.boolean().optional(),
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
 * 执行 RedInk 图片生成代理。
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

  const payload = imageRequestSchema.safeParse(await request.json());
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
  const selectedModel = await resolveImageModel(
    payload.data.projectKey,
    session.user.id,
    payload.data.model
  );
  if (!selectedModel) {
    return NextResponse.json(
      {
        success: false,
        error: "model_not_allowed",
        message: "当前图片场景没有可用模型",
      },
      { status: 403 }
    );
  }

  try {
    const result = await executeAIChat({
      userId: session.user.id,
      toolKey: "redink",
      featureKey: getRedinkImageFeatureKey(payload.data.scene),
      projectKey: payload.data.projectKey,
      messages,
      model: selectedModel,
      operation:
        payload.data.operation ??
        inferImageOperation(messages, payload.data.image),
      modalities: ["image"],
      ...(payload.data.image ? { image: payload.data.image } : {}),
      ...(payload.data.background !== undefined
        ? { background: payload.data.background }
        : {}),
      ...(payload.data.async !== undefined
        ? { async: payload.data.async }
        : {}),
      metadata: {
        ...(payload.data.metadata ?? {}),
        projectKey: payload.data.projectKey,
        redinkScene: payload.data.scene,
        redinkModelGroup: "image_generation",
      },
    });

    return NextResponse.json({
      success: true,
      scene: payload.data.scene,
      modelGroup: "image_generation",
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
 * 校验图片场景允许使用的模型。
 */
async function resolveImageModel(
  projectKey: string,
  userId: string,
  requestedModel?: string
) {
  const resolved = await resolveRedinkUserModel(
    requestedModel
      ? {
          projectKey,
          userId,
          group: "image_generation",
          requestedModel,
        }
      : {
          projectKey,
          userId,
          group: "image_generation",
        }
  );

  if (!resolved.selectedModel) {
    return null;
  }

  return resolved.selectedModel;
}

function inferImageOperation(
  messages: Awaited<ReturnType<typeof normalizeRedinkMessages>>,
  image: Record<string, unknown> | undefined
) {
  const hasImageInput = messages.some((message) =>
    Array.isArray(message.content)
      ? message.content.some(
          (part) => part.type === "image_url" || part.type === "image_asset"
        )
      : false
  );

  if (
    hasImageInput &&
    image &&
    (typeof image.mask === "string" ||
      image.mode === "edit" ||
      image.operation === "edit")
  ) {
    return "image.edit" as const;
  }

  return "image.generate" as const;
}
