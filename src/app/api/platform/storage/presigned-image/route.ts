import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorageProvider } from "@/features/storage/providers";
import {
  findReusableStorageObject,
  resolveToolStoragePrefix,
  saveStorageObjectRecord,
} from "@/features/storage/records";
import {
  ALLOWED_IMAGE_TYPES,
  type AllowedImageType,
  MAX_FILE_SIZE,
} from "@/features/storage/types";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const presignedImageSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE).optional(),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  toolKey: z.string().trim().min(1).max(80).default("redink"),
  purpose: z.string().trim().min(1).max(80).default("product_image"),
  retentionClass: z
    .enum(["permanent", "long_term", "temporary", "ephemeral"])
    .default("long_term"),
  expiresAt: z.string().datetime().optional(),
  requestId: z.string().trim().min(1).max(120).optional(),
  taskId: z.string().trim().min(1).max(120).optional(),
});

/**
 * 返回上传后可访问的资源地址。
 */
function resolvePublicUrl(
  provider: ReturnType<typeof getStorageProvider>,
  uploadUrl: string,
  key: string,
  bucket: string
) {
  return typeof provider.getPublicUrl === "function"
    ? provider.getPublicUrl(key, bucket)
    : uploadUrl;
}

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
  const normalizedChecksum = payload.data.checksumSha256?.toLowerCase() ?? null;
  if (normalizedChecksum) {
    const reused = await findReusableStorageObject({
      bucket,
      ownerUserId: session.user.id,
      sha256: normalizedChecksum,
      contentType: payload.data.contentType,
      size: payload.data.fileSize ?? null,
    });
    if (reused) {
      const provider = getStorageProvider();
      const reusedUrl = resolvePublicUrl(
        provider,
        "",
        reused.key,
        reused.bucket
      );
      return NextResponse.json({
        success: true,
        reused: true,
        uploadUrl: null,
        publicUrl: reusedUrl,
        key: reused.key,
        bucket: reused.bucket,
        purpose: reused.purpose,
        retentionClass: reused.retentionClass,
        expiresAt: reused.expiresAt,
        requestId: reused.requestId,
        taskId: reused.taskId,
        maxFileSize: MAX_FILE_SIZE,
        contentType: reused.contentType,
        size: reused.size,
        status: "ready",
        confirmUrl: "/api/platform/storage/object",
      });
    }
  }

  const extension =
    payload.data.filename.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ".png";
  const prefix = await resolveToolStoragePrefix({
    toolKey: payload.data.toolKey,
    purpose: payload.data.purpose,
    fallbackPrefix: `${payload.data.toolKey}/product-images/`,
  });
  const key = `${prefix}${session.user.id}/${nanoid()}${extension}`;
  const provider = getStorageProvider();
  const uploadUrl = await provider.getSignedUploadUrl(
    key,
    bucket,
    payload.data.contentType as AllowedImageType
  );
  const publicUrl = resolvePublicUrl(provider, uploadUrl, key, bucket);
  const storageRecord = await saveStorageObjectRecord({
    bucket,
    key,
    contentType: payload.data.contentType,
    ownerUserId: session.user.id,
    toolKey: payload.data.toolKey,
    purpose: payload.data.purpose,
    retentionClass: payload.data.retentionClass,
    expiresAt: payload.data.expiresAt ? new Date(payload.data.expiresAt) : null,
    size: payload.data.fileSize ?? null,
    requestId: payload.data.requestId ?? null,
    taskId: payload.data.taskId ?? null,
    status: "pending",
    metadata: {
      source: "presigned_image",
      originalFilename: payload.data.filename,
      ...(payload.data.fileSize
        ? { originalFileSize: payload.data.fileSize }
        : {}),
      ...(normalizedChecksum ? { sha256: normalizedChecksum } : {}),
    },
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
    requestId: storageRecord.requestId,
    taskId: storageRecord.taskId,
    status: storageRecord.status,
    size: storageRecord.size,
    reused: false,
    confirmUrl: "/api/platform/storage/object",
    maxFileSize: MAX_FILE_SIZE,
    contentType: payload.data.contentType,
  });
});
