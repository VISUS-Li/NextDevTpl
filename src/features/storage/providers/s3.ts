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
  };
}

/**
 * 获取 S3 客户端实例 (单例模式)
 *
 * 延迟初始化，避免在模块加载时就检查环境变量
 */
function getS3Client(): S3Client {
  if (!s3Client) {
    const config = getStorageConfig();

    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Cloudflare R2 需要的配置
      forcePathStyle: true,
    });
  }

  return s3Client;
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

/**
 * 获取默认存储提供者
 *
 * 当前默认使用 S3 兼容存储
 */
export function getStorageProvider(): StorageProvider {
  return s3Provider;
}
