/**
 * AI 存储代理测试
 *
 * 验证平台会生成带签名的代理 URL，并且公开对象路由可以正常回源对象内容。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getStorageObject } from "@/app/api/platform/storage/object/route";
import { getStorageAssetProxyUrl } from "@/features/storage/utils";

const { getObjectMock } = vi.hoisted(() => ({
  getObjectMock: vi.fn(),
}));

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    getObject: getObjectMock,
  }),
}));

describe("Storage AI Proxy API", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://platform.tripai.icu";
    process.env.STORAGE_AI_PROXY_BASE_URL = "https://platform.tripai.icu";
    process.env.BETTER_AUTH_SECRET = "dev-secret-nextdevtpl-local-2026";
    getObjectMock.mockReset();
  });

  it("应生成平台代理 URL", () => {
    const url = getStorageAssetProxyUrl("tripai", "redink/demo.png", 600);
    expect(url).toContain("https://platform.tripai.icu/api/platform/storage/object");
    expect(url).toContain("bucket=tripai");
    expect(url).toContain("signature=");
  });

  it("公开对象路由应返回 inline 内容", async () => {
    getObjectMock.mockResolvedValue(Buffer.from("png-data"));
    const url = getStorageAssetProxyUrl("tripai", "redink/demo.png", 600);

    const response = await getStorageObject(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "png-data"
    );
  });

  it("签名错误时应拒绝访问", async () => {
    const url = new URL(
      "https://platform.tripai.icu/api/platform/storage/object?bucket=tripai&key=redink/demo.png&expires=9999999999&signature=bad"
    );

    const response = await getStorageObject(new Request(url));

    expect(response.status).toBe(403);
  });
});
