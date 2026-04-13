/**
 * 存储清理阶段三测试
 *
 * 验证管理员可以清理已过期的对象资源。
 */

import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postCleanupExpired } from "@/app/api/platform/storage/admin/cleanup-expired/route";
import { db } from "@/db";
import { storageObject } from "@/db/schema";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser } from "../utils";

const createdUserIds: string[] = [];
const createdObjectIds: string[] = [];
const deleteObjectMock = vi.fn(async () => undefined);

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    deleteObject: deleteObjectMock,
  }),
}));

afterAll(async () => {
  if (createdObjectIds.length > 0) {
    await db
      .delete(storageObject)
      .where(inArray(storageObject.id, createdObjectIds));
  }
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

beforeEach(() => {
  deleteObjectMock.mockClear();
});

/**
 * 模拟管理员会话。
 */
function mockAdminSession(user: { id: string; name: string; email: string }) {
  vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: {
      id: `session_${user.id}`,
      token: `token_${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      ...user,
      role: "admin",
    },
  } as never);
}

describe("Storage Phase 3 Cleanup API", () => {
  it("应只清理已过期资源并标记删除状态", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+storage-phase3-admin-${Date.now()}@qq.com`,
      name: "存储阶段三管理员",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);
    mockAdminSession(adminUser);

    await db
      .delete(storageObject)
      .where(
        and(
          isNull(storageObject.deletedAt),
          ne(storageObject.status, "deleted"),
          lt(storageObject.expiresAt, new Date())
        )
      );

    const expiredId = crypto.randomUUID();
    const futureId = crypto.randomUUID();
    createdObjectIds.push(expiredId, futureId);

    await db.insert(storageObject).values([
      {
        id: expiredId,
        bucket: "nextdevtpl-uploads",
        key: "platform/ai-assets/request/expired/image.png",
        contentType: "image/png",
        ownerUserId: adminUser.id,
        purpose: "ai_input_temp",
        retentionClass: "ephemeral",
        expiresAt: new Date(Date.now() - 60_000),
        status: "ready",
      },
      {
        id: futureId,
        bucket: "nextdevtpl-uploads",
        key: "platform/ai-assets/request/future/image.png",
        contentType: "image/png",
        ownerUserId: adminUser.id,
        purpose: "ai_input_temp",
        retentionClass: "ephemeral",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "ready",
      },
    ]);

    const response = await postCleanupExpired(
      new Request(
        "http://localhost:3000/api/platform/storage/admin/cleanup-expired",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            limit: 10,
            dryRun: false,
          }),
        }
      )
    );
    const data = await response.json();
    const [expiredRecord] = await db
      .select()
      .from(storageObject)
      .where(eq(storageObject.id, expiredId))
      .limit(1);
    const [futureRecord] = await db
      .select()
      .from(storageObject)
      .where(eq(storageObject.id, futureId))
      .limit(1);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.total).toBe(1);
    expect(data.deleted).toBe(1);
    expect(expiredRecord?.status).toBe("deleted");
    expect(expiredRecord?.deletedAt).not.toBeNull();
    expect(futureRecord?.status).toBe("ready");
    expect(deleteObjectMock).toHaveBeenCalledOnce();
  });
});
