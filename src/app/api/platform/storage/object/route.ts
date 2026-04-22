import { NextResponse } from "next/server";
import { z } from "zod";

import { getStorageProvider } from "@/features/storage/providers";
import { confirmStorageObjectUpload } from "@/features/storage/records";
import { verifyStorageAssetSignature } from "@/features/storage/utils";
import { auth } from "@/lib/auth";

/**
 * 按扩展名推断内容类型，避免 AI 上游拿到二进制流时缺少 mime。
 */
function getContentTypeFromKey(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".mp4")) return "video/mp4";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".m4a")) return "audio/mp4";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

/**
 * 公开对象代理。
 *
 * 该接口专门给 AI 上游读取临时对象，不要求用户登录，改用短时签名校验。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket")?.trim() || "";
  const key = url.searchParams.get("key")?.trim() || "";
  const signature = url.searchParams.get("signature")?.trim() || "";
  const expires = Number(url.searchParams.get("expires"));

  if (
    !bucket ||
    !key ||
    !signature ||
    !verifyStorageAssetSignature(bucket, key, expires, signature)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_signature",
      },
      { status: 403 }
    );
  }

  const provider = getStorageProvider();
  const content = await provider.getObject(key, bucket);
  const filename = key.split("/").pop() || "asset";
  const download = url.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": getContentTypeFromKey(key),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

const confirmUploadSchema = z.object({
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(1024),
  size: z.number().int().nonnegative().optional(),
  contentType: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 回写对象上传完成状态。
 */
export async function POST(request: Request) {
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

  const payload = confirmUploadSchema.safeParse(await request.json());
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

  const record = await confirmStorageObjectUpload({
    bucket: payload.data.bucket,
    key: payload.data.key,
    ownerUserId: session.user.id,
    size: payload.data.size ?? null,
    contentType: payload.data.contentType ?? null,
    metadata: payload.data.metadata ?? null,
  });

  if (!record) {
    return NextResponse.json(
      {
        success: false,
        error: "资源不存在或无权限",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    status: record.status,
    size: record.size,
    bucket: record.bucket,
    key: record.key,
    updatedAt: record.updatedAt,
  });
}
