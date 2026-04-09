import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import { saveStorageObjectRecord } from "@/features/storage";
import { getStorageProvider } from "@/features/storage/providers";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_SIZE,
  type AllowedImageType,
} from "@/features/storage/types";

const presignedImageSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE).optional(),
  purpose: z.string().trim().min(1).max(80).default("product_image"),
  retentionClass: z
    .enum(["permanent", "long_term", "temporary", "ephemeral"])
    .default("long_term"),
  expiresAt: z.string().datetime().optional(),
});

/**
 * 获取商品图的预签名上传地址
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

  const payload = presignedImageSchema.safeParse(await request.json());
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

  const bucket = process.env.STORAGE_BUCKET_NAME || "nextdevtpl-uploads";
  const extension =
    payload.data.filename.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ".png";
  const key = `redink/product-images/${session.user.id}/${nanoid()}${extension}`;
  const provider = getStorageProvider();
  const uploadUrl = await provider.getSignedUploadUrl(
    key,
    bucket,
    payload.data.contentType as AllowedImageType
  );
  const publicUrl = provider.getPublicUrl(key, bucket);
  const storageRecord = await saveStorageObjectRecord({
    bucket,
    key,
    contentType: payload.data.contentType,
    ownerUserId: session.user.id,
    toolKey: "redink",
    purpose: payload.data.purpose,
    retentionClass: payload.data.retentionClass,
    expiresAt: payload.data.expiresAt
      ? new Date(payload.data.expiresAt)
      : null,
    status: "pending",
  });

  return NextResponse.json({
    success: true,
    uploadUrl,
    publicUrl,
    key,
    bucket,
    purpose: storageRecord.purpose,
    retentionClass: storageRecord.retentionClass,
    expiresAt: storageRecord.expiresAt,
    maxFileSize: MAX_FILE_SIZE,
    contentType: payload.data.contentType,
  });
});
