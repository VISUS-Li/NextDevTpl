/**
 * 存储生命周期阶段二测试
 *
 * 验证上传和归档接口会写入资源元数据。
 */

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postSaveResult } from "@/app/api/platform/results/save/route";
import { POST as postPresignedImage } from "@/app/api/platform/storage/presigned-image/route";
import { POST as postUploadPresigned } from "@/app/api/upload/presigned/route";
import { db } from "@/db";
import { storageObject } from "@/db/schema";
import { saveStoragePolicyConfig } from "@/features/storage/records";
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
const putObjectMock = vi.fn(async () => undefined);

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    getSignedUploadUrl: getSignedUploadUrlMock,
    getPublicUrl: getPublicUrlMock,
    putObject: putObjectMock,
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
  putObjectMock.mockClear();
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

describe("Storage Phase 2 Lifecycle API", () => {
  it("presigned-image 应写入临时资源元数据", async () => {
    const user = await createTestUser({
      email: `1183989659+storage-phase2-image-${Date.now()}@qq.com`,
      name: "存储阶段二图片用户",
    });
    createdUserIds.push(user.id);
    mockSession(user);

    const response = await postPresignedImage(
      new Request(
        "http://localhost:3000/api/platform/storage/presigned-image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: "image.png",
            contentType: "image/png",
            fileSize: 1024,
            purpose: "ai_input_temp",
            retentionClass: "temporary",
          }),
        }
      )
    );
    const data = await response.json();
    const [record] = await db
      .select()
      .from(storageObject)
      .where(eq(storageObject.key, data.key))
      .limit(1);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(record?.purpose).toBe("ai_input_temp");
    expect(record?.retentionClass).toBe("temporary");
    expect(record?.status).toBe("pending");
  });

  it("upload/presigned 应写入超短期资源元数据", async () => {
    const user = await createTestUser({
      email: `1183989659+storage-phase2-upload-${Date.now()}@qq.com`,
      name: "存储阶段二文档用户",
    });
    createdUserIds.push(user.id);
    mockSession(user);

    const response = await postUploadPresigned(
      new NextRequest("http://localhost:3000/api/upload/presigned", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: "notes.md",
          contentType: "text/markdown",
          fileSize: 2048,
          purpose: "draft_temp",
          retentionClass: "ephemeral",
        }),
      })
    );
    const data = await response.json();
    const [record] = await db
      .select()
      .from(storageObject)
      .where(eq(storageObject.key, data.fileKey))
      .limit(1);

    expect(response.status).toBe(200);
    expect(record?.purpose).toBe("draft_temp");
    expect(record?.retentionClass).toBe("ephemeral");
    expect(record?.status).toBe("pending");
  });

  it("results/save 应写入长期归档资源元数据", async () => {
    const user = await createTestUser({
      email: `1183989659+storage-phase2-result-${Date.now()}@qq.com`,
      name: "存储阶段二结果用户",
    });
    createdUserIds.push(user.id);
    mockSession(user);

    const response = await postSaveResult(
      new Request("http://localhost:3000/api/platform/results/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          type: "product_copy_generation",
          payload: {
            productName: "测试水杯",
          },
        }),
      })
    );
    const data = await response.json();
    const [record] = await db
      .select()
      .from(storageObject)
      .where(eq(storageObject.key, data.key))
      .limit(1);

    expect(response.status).toBe(200);
    expect(record?.purpose).toBe("result_archive");
    expect(record?.retentionClass).toBe("long_term");
    expect(record?.status).toBe("ready");
    expect(putObjectMock).toHaveBeenCalledOnce();
  });

  it("后台生命周期策略应影响默认过期时间", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+storage-phase2-policy-${Date.now()}@qq.com`,
      name: "存储阶段二策略用户",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);
    mockSession(adminUser);
    await seedDefaultToolConfigProject();
    await saveStoragePolicyConfig({
      actorId: adminUser.id,
      policy: {
        ephemeralHours: 2,
        temporaryDays: 5,
        longTermDays: 120,
        prefixRules: [
          {
            prefix: "platform/ai-assets/request/",
            retentionClass: "ephemeral",
            ttlHours: 12,
            purpose: "ai_input_temp",
            enabled: true,
          },
        ],
      },
    });

    const start = Date.now();
    const response = await postPresignedImage(
      new Request(
        "http://localhost:3000/api/platform/storage/presigned-image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: "image.png",
            contentType: "image/png",
            retentionClass: "temporary",
            purpose: "policy_check",
          }),
        }
      )
    );
    const data = await response.json();
    const expiresAt = new Date(data.expiresAt).getTime();

    expect(response.status).toBe(200);
    expect(expiresAt).toBeGreaterThan(start + 4.5 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThan(start + 5.5 * 24 * 60 * 60 * 1000);
  });
});
