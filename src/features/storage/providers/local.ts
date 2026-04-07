/**
 * 本地文件存储提供者。
 */

import type { StorageProvider } from "../types";

const localStorageRoot = process.env.LOCAL_STORAGE_DIR || ".local-storage";

async function getNodeStorageModules() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return { fs, path: path.default };
}

// 解析本地存储路径，避免 key 逃逸到存储目录外。
async function resolveLocalPath(bucket: string, key: string) {
  const { path } = await getNodeStorageModules();
  const root = path.resolve(localStorageRoot);
  const filePath = path.resolve(root, bucket, key);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("存储路径非法");
  }
  return filePath;
}

// 生成当前开发环境可访问的本地存储 API 地址。
function getLocalBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

// 递归列出目录下的文件，用于兼容 S3 listObjects 行为。
async function walkFiles(
  dir: string
): Promise<Array<{ path: string; statTime: Date; size: number }>> {
  const { fs, path } = await getNodeStorageModules();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(fullPath);
      }
      const fileStat = await fs.stat(fullPath);
      return [
        { path: fullPath, statTime: fileStat.mtime, size: fileStat.size },
      ];
    })
  );
  return files.flat();
}

export const localProvider: StorageProvider = {
  async getSignedUrl(key: string, bucket: string): Promise<string> {
    return `${getLocalBaseUrl()}/api/platform/storage/local-object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
  },

  async getSignedUploadUrl(
    key: string,
    bucket: string,
    contentType: string
  ): Promise<string> {
    return `${getLocalBaseUrl()}/api/platform/storage/local-upload?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`;
  },

  async deleteObject(key: string, bucket: string): Promise<void> {
    const { fs } = await getNodeStorageModules();
    await fs.rm(await resolveLocalPath(bucket, key), { force: true });
  },

  async putObject(
    key: string,
    bucket: string,
    body: Buffer | Uint8Array | string,
    _contentType: string
  ): Promise<void> {
    const { fs, path } = await getNodeStorageModules();
    const filePath = await resolveLocalPath(bucket, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
  },

  async getObject(key: string, bucket: string): Promise<Buffer> {
    const { fs } = await getNodeStorageModules();
    return fs.readFile(await resolveLocalPath(bucket, key));
  },

  async listObjects(
    prefix: string,
    bucket: string,
    maxKeys: number = 20
  ): Promise<Array<{ key: string; lastModified?: Date; size?: number }>> {
    const { path } = await getNodeStorageModules();
    const basePath = await resolveLocalPath(bucket, prefix);
    const bucketPath = await resolveLocalPath(bucket, "");
    try {
      const files = await walkFiles(basePath);
      return files
        .sort((a, b) => b.statTime.getTime() - a.statTime.getTime())
        .slice(0, maxKeys)
        .map((item) => ({
          key: path.relative(bucketPath, item.path).split(path.sep).join("/"),
          lastModified: item.statTime,
          size: item.size,
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  },
};
