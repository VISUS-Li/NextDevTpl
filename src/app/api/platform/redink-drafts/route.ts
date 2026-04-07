import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { redinkDraft } from "@/db/schema";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

const imageSchema = z.object({
  index: z.number().int().nonnegative(),
  url: z.string().min(1),
  thumbnail_url: z.string().optional(),
  filename: z.string().optional(),
  prompt: z.string().optional(),
});

const assetSchema = z.object({
  key: z.string().min(1),
  bucket: z.string().min(1),
});

const saveRedinkDraftSchema = z.object({
  product_info: z.record(z.string(), z.unknown()),
  source_asset: assetSchema.optional(),
  selected_title: z.string().trim().min(1),
  selected_copywriting: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).min(1),
  image_prompt: z.string().trim().min(1),
  selected_images: z.array(imageSchema).min(1),
});

/**
 * 保存 RedInk 商品发布草稿
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

  const payload = saveRedinkDraftSchema.safeParse(await request.json());
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

  const [draft] = await db
    .insert(redinkDraft)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      productInfo: payload.data.product_info,
      sourceAsset: payload.data.source_asset,
      selectedTitle: payload.data.selected_title,
      selectedCopywriting: payload.data.selected_copywriting,
      tags: payload.data.tags,
      imagePrompt: payload.data.image_prompt,
      selectedImages: payload.data.selected_images,
    })
    .returning({
      id: redinkDraft.id,
      createdAt: redinkDraft.createdAt,
    });

  return NextResponse.json({
    success: true,
    draft,
  });
});
