/**
 * S3 兼容存储提供者
 *
 * 支持 AWS S3、Cloudflare R2、MinIO 等 S3 兼容存储
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  DEFAULT_SIGNED_URL_EXPIRES,
  DEFAULT_UPLOAD_URL_EXPIRES,
  type S3StorageConfig,
  type StorageProvider,
} from "../types";

// ============================================
// S3 客户端单例
// ============================================

let s3Client: S3Client | null = null;
let cachedClientKey: string | null = null;

/**
 * 获取存储配置
 *
 * 从环境变量读取 S3 兼容存储配置
 */
function getStorageConfig(): S3StorageConfig {
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const endpoint = process.env.STORAGE_ENDPOINT;
  const region = process.env.STORAGE_REGION ?? "auto";
  const vendor = process.env.STORAGE_VENDOR ?? "generic";
  const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL?.trim() || null;
  const forcePathStyle = parseForcePathStyle(vendor);

  // 验证必需的环境变量
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "存储配置缺失: 请设置 STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_ENDPOINT 环境变量"
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    vendor,
    forcePathStyle,
    publicBaseUrl,
  };
}

/**
 * 解析 path-style 开关。
 */
function parseForcePathStyle(vendor: string) {
  const explicit = process.env.STORAGE_FORCE_PATH_STYLE?.trim();
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  // 火山 TOS、腾讯 COS、阿里 OSS 实测都应优先使用 virtual-hosted style。
  if (vendor === "tos" || vendor === "cos" || vendor === "oss") {
    return false;
  }
  // R2、MinIO 默认更适合 path-style。
  if (vendor === "r2" || vendor === "minio") {
    return true;
  }
  return false;
}

/**
 * 构造缓存键，避免切换配置后仍复用旧客户端。
 */
function buildClientCacheKey(config: S3StorageConfig) {
  return [
    config.vendor,
    config.region,
    config.endpoint,
    config.accessKeyId,
    config.forcePathStyle ? "path" : "host",
  ].join("|");
}

/**
 * 获取 S3 客户端实例 (单例模式)
 *
 * 延迟初始化，避免在模块加载时就检查环境变量
 */
function getS3Client(): S3Client {
  const config = getStorageConfig();
  const cacheKey = buildClientCacheKey(config);
  if (!s3Client || cachedClientKey !== cacheKey) {
    cachedClientKey = cacheKey;

    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  return s3Client;
}

/**
 * 规范拼接公开访问地址。
 */
function joinPublicUrl(baseUrl: string, bucket: string, key: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const parsed = new URL(normalizedBaseUrl);
  const hostPrefix = `${bucket}.`;
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (parsed.hostname.startsWith(hostPrefix)) {
    return `${normalizedBaseUrl}/${encodedKey}`;
  }
  if (pathname && pathname !== "/") {
    return `${normalizedBaseUrl}/${encodedKey}`;
  }
  return `${normalizedBaseUrl}/${encodeURIComponent(bucket)}/${encodedKey}`;
}

// ============================================
// S3 存储提供者实现
// ============================================

/**
 * S3 兼容存储提供者
 *
 * 实现 StorageProvider 接口，支持：
 * - Cloudflare R2
 * - AWS S3
 * - MinIO
 * - 其他 S3 兼容存储
 */
export const s3Provider: StorageProvider = {
  /**
   * 获取签名读取 URL
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @param expiresIn - 有效期 (秒)
   * @returns 签名 URL
   */
  async getSignedUrl(
    key: string,
    bucket: string,
    expiresIn: number = DEFAULT_SIGNED_URL_EXPIRES
  ): Promise<string> {
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const signedUrl = await getSignedUrl(client, command, {
      expiresIn,
    });

    return signedUrl;
  },

  getPublicUrl(key: string, bucket: string): string {
    const config = getStorageConfig();
    if (config.publicBaseUrl) {
      return joinPublicUrl(config.publicBaseUrl, bucket, key);
    }
    // 没有公开域名时，回退到签名 URL 调用链之外的直接对象地址。
    // 这里主要供可公开访问的对象存储使用；私有桶仍建议在业务层改走 getSignedUrl。
    if (config.forcePathStyle) {
      return joinPublicUrl(config.endpoint, bucket, key);
    }
    const endpoint = new URL(config.endpoint);
    endpoint.hostname = `${bucket}.${endpoint.hostname}`;
    endpoint.pathname = key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return endpoint.toString();
  },

  /**
   * 获取签名上传 URL
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @param contentType - 文件 MIME 类型
   * @param expiresIn - 有效期 (秒)
   * @returns 签名上传 URL
   */
  async getSignedUploadUrl(
    key: string,
    bucket: string,
    contentType: string,
    expiresIn: number = DEFAULT_UPLOAD_URL_EXPIRES
  ): Promise<string> {
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(client, command, {
      expiresIn,
    });

    return signedUrl;
  },

  /**
   * 删除文件
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   */
  async deleteObject(key: string, bucket: string): Promise<void> {
    const client = getS3Client();

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);
  },

  /**
   * 直接写入对象
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @param body - 文件内容
   * @param contentType - 内容类型
   */
  async putObject(
    key: string,
    bucket: string,
    body: Buffer | Uint8Array | string,
    contentType: string
  ): Promise<void> {
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await client.send(command);
  },

  /**
   * 获取文件内容
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @returns 文件内容 Buffer
   */
  async getObject(key: string, bucket: string): Promise<Buffer> {
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error(`File not found: ${key}`);
    }

    // 将 ReadableStream 转换为 Buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  },

  /**
   * 列出对象
   *
   * @param prefix - 键名前缀
   * @param bucket - 存储桶名称
   * @param maxKeys - 最大返回数量
   * @returns 对象列表
   */
  async listObjects(
    prefix: string,
    bucket: string,
    maxKeys: number = 20
  ): Promise<Array<{ key: string; lastModified?: Date; size?: number }>> {
    const client = getS3Client();

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await client.send(command);
    return (response.Contents ?? [])
      .filter((item) => !!item.Key)
      .map((item) => {
        const result: { key: string; lastModified?: Date; size?: number } = {
          key: item.Key!,
        };
        if (item.LastModified) {
          result.lastModified = item.LastModified;
        }
        if (typeof item.Size === "number") {
          result.size = item.Size;
        }
        return result;
      });
  },
};

// ============================================
// 便捷函数导出
// ============================================
