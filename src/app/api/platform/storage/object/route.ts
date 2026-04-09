import { NextResponse } from "next/server";

import { getStorageProvider } from "@/features/storage/providers";
import { verifyStorageAssetSignature } from "@/features/storage/utils";

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

  if (!bucket || !key || !signature || !verifyStorageAssetSignature(bucket, key, expires, signature)) {
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

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": getContentTypeFromKey(key),
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
