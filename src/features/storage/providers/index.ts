/**
 * 存储提供者导出
 */

import type { StorageProvider } from "../types";

import { localProvider } from "./local";
import { s3Provider } from "./s3";

export { localProvider } from "./local";
export { s3Provider } from "./s3";

export function getStorageProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === "local" ? localProvider : s3Provider;
}
