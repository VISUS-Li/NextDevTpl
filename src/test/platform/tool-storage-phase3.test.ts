import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postPresignedImage } from "@/app/api/platform/storage/presigned-image/route";
import { db } from "@/db";
import { storageObject, toolStorageRule } from "@/db/schema";
import { seedDefaultToolConfigProject } from "@/features/tool-config";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser } from "../utils";

const createdUserIds: string[] = [];
const getSignedUploadUrlMock = vi.fn(
  async (key: string, bucket: string) => `https://upload.test/${bucket}/${key}`
);
const getPublicUrlMock = vi.fn(
  (key: string, bucket: string) => `https://assets.test/${bucket}/${key}`
);

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    getSignedUploadUrl: getSignedUploadUrlMock,
    getPublicUrl: getPublicUrlMock,
  }),
}));

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(storageObject).where(eq(storageObject.ownerUserId, userId));
  }
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

beforeEach(() => {
  getSignedUploadUrlMock.mockClear();
  getPublicUrlMock.mockClear();
});

/**
 * 模拟当前用户会话。
 */
function mockSession(user: { id: string; name: string; email: string }) {
  vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: {
      id: `session_${user.id}`,
      token: `token_${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user,
  } as never);
}

describe("Tool storage phase 3", () => {
  it("presigned-image 应支持按 toolKey 和 purpose 使用工具存储规则", async () => {
    const user = await createTestUser({
      email: `1183989659+tool-storage-phase3-${Date.now()}@qq.com`,
      name: "工具存储阶段三用户",
    });
    createdUserIds.push(user.id);
    mockSession(user);
    await seedDefaultToolConfigProject();

    const response = await postPresignedImage(
      new Request(
        "http://localhost:3000/api/platform/storage/presigned-image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolKey: "redink",
            filename: "temp.png",
            contentType: "image/png",
            purpose: "product_image_temp",
            retentionClass: "temporary",
          }),
        }
      )
    );
    const body = await response.json();
    const [ruleRow] = await db
      .select()
      .from(toolStorageRule)
      .where(
        and(
          eq(toolStorageRule.toolKey, "redink"),
          eq(toolStorageRule.purpose, "product_image_temp")
        )
      )
      .limit(1);
    const [storageRow] = await db
      .select()
      .from(storageObject)
      .where(eq(storageObject.key, body.key))
      .limit(1);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(ruleRow).toMatchObject({
      toolKey: "redink",
      purpose: "product_image_temp",
      prefix: "redink/product-images-temp/",
      ttlHours: 168,
    });
    expect(body.key).toContain("redink/product-images-temp/");
    expect(storageRow?.metadata).toMatchObject({
      matchedPrefixRule: "redink/product-images-temp/",
    });
    expect(storageRow?.toolKey).toBe("redink");
    expect(storageRow?.purpose).toBe("product_image_temp");
  });
});
