import { createHmac } from "node:crypto";

/**
 * 存储 URL 工具函数
 *
 * 处理存储键名和外部 URL 的转换
 */

// ============================================
// 头像 URL 工具
// ============================================

/**
 * 判断是否为外部 URL
 *
 * 外部 URL 包括:
 * - OAuth 提供的头像 (GitHub, Google 等)
 * - 其他完整 URL
 *
 * @param value - URL 或存储键名
 * @returns 是否为外部 URL
 */
export function isExternalUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith("http://") || value.startsWith("https://");
}

/**
 * 获取头像显示 URL
 *
 * 根据传入的值返回正确的 URL:
 * - 如果是外部 URL (http/https 开头)，直接返回
 * - 如果是存储键名，转换为 image-proxy URL
 * - 如果为空，返回 undefined
 *
 * @param image - 用户的 image 字段值 (可能是 URL 或存储键名)
 * @returns 头像显示 URL 或 undefined
 *
 * @example
 * ```ts
 * // 外部 URL (OAuth 头像)
 * getAvatarUrl("https://avatars.githubusercontent.com/u/12345")
 * // => "https://avatars.githubusercontent.com/u/12345"
 *
 * // 存储键名
 * getAvatarUrl("user-abc123-1234567890.jpg")
 * // => "/image-proxy/avatars/user-abc123-1234567890.jpg"
 *
 * // 空值
 * getAvatarUrl(null) // => undefined
 * ```
 */
export function getAvatarUrl(image: string | null | undefined): string | undefined {
  if (!image) {
    return undefined;
  }

  // 如果是外部 URL，直接返回
  if (isExternalUrl(image)) {
    return image;
  }

  // 否则是存储键名，转换为 image-proxy URL
  const avatarsBucket = process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME ?? "avatars";
  return `/image-proxy/${avatarsBucket}/${image}`;
}

/**
 * 生成供 AI 上游访问的代理链接签名。
 */
function signStorageAssetPayload(bucket: string, key: string, expires: number) {
  const secret =
    process.env.STORAGE_ASSET_PROXY_SECRET ||
    process.env.CONFIG_SECRET_KEY ||
    process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("缺少 STORAGE_ASSET_PROXY_SECRET 或 CONFIG_SECRET_KEY");
  }
  return createHmac("sha256", secret)
    .update(`${bucket}\n${key}\n${expires}`)
    .digest("hex");
}

/**
 * 构造 AI 资产代理地址。
 */
export function getStorageAssetProxyUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600
) {
  const baseUrl =
    process.env.STORAGE_AI_PROXY_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const signature = signStorageAssetPayload(bucket, key, expires);
  const url = new URL("/api/platform/storage/object", baseUrl);
  url.searchParams.set("bucket", bucket);
  url.searchParams.set("key", key);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

/**
 * 校验 AI 资产代理签名。
 */
export function verifyStorageAssetSignature(
  bucket: string,
  key: string,
  expires: number,
  signature: string
) {
  if (!Number.isFinite(expires) || expires <= 0) {
    return false;
  }
  if (expires < Math.floor(Date.now() / 1000)) {
    return false;
  }
  return signStorageAssetPayload(bucket, key, expires) === signature;
}

/**
 * 生成唯一的头像文件名
 *
 * 格式: {userId}-{timestamp}.{extension}
 *
 * @param userId - 用户 ID
 * @param file - 上传的文件
 * @returns 唯一的文件键名
 */
export function generateAvatarKey(userId: string, file: File): string {
  const timestamp = Date.now();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  return `${userId}-${timestamp}.${extension}`;
}
