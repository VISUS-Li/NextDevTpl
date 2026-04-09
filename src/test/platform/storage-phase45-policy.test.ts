/**
 * 存储策略与主动清理测试
 *
 * 验证后台生命周期策略、前缀规则和按 requestId 整组删除。
 */

import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postCleanupScope } from "@/app/api/platform/storage/admin/cleanup-scope/route";
import { db } from "@/db";
import { storageObject } from "@/db/schema";
import { saveStorageObjectRecord } from "@/features/storage";
import {
  saveAdminToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
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

describe("Storage Phase 4/5 Policy", () => {
  it("后台前缀规则应影响资源过期时间和元数据", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+storage-phase45-policy-${Date.now()}@qq.com`,
      name: "存储策略管理员",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);
    await seedDefaultToolConfigProject();
    await saveAdminToolConfig({
      toolKey: "storage",
      actorId: adminUser.id,
      values: {
        config1: 6,
        config2: 3,
        config3: 90,
        json1: [
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
    const record = await saveStorageObjectRecord({
      bucket: "tripai",
      key: "platform/ai-assets/request/demo/image.png",
      contentType: "image/png",
      ownerUserId: adminUser.id,
      purpose: "ai_input_temp",
      retentionClass: "ephemeral",
      requestId: "req_policy_case",
      status: "ready",
    });
    createdObjectIds.push(record.id);

    expect(record.metadata).toMatchObject({
      matchedPrefixRule: "platform/ai-assets/request/",
    });
    expect(record.expiresAt?.getTime()).toBeGreaterThan(
      start + 11.5 * 60 * 60 * 1000
    );
    expect(record.expiresAt?.getTime()).toBeLessThan(
      start + 12.5 * 60 * 60 * 1000
    );
  });

  it("cleanup-scope 接口应按 requestId 删除整组资源", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+storage-phase45-clean-${Date.now()}@qq.com`,
      name: "存储清理管理员",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);
    mockAdminSession(adminUser);

    const first = await saveStorageObjectRecord({
      bucket: "tripai",
      key: "platform/ai-assets/request/req_cleanup/a.png",
      contentType: "image/png",
      ownerUserId: adminUser.id,
      purpose: "ai_input_temp",
      retentionClass: "ephemeral",
      requestId: "req_cleanup",
      status: "ready",
    });
    const second = await saveStorageObjectRecord({
      bucket: "tripai",
      key: "platform/ai-assets/request/req_cleanup/b.png",
      contentType: "image/png",
      ownerUserId: adminUser.id,
      purpose: "ai_input_temp",
      retentionClass: "ephemeral",
      requestId: "req_cleanup",
      status: "ready",
    });
    createdObjectIds.push(first.id, second.id);

    const response = await postCleanupScope(
      new Request(
        "http://localhost:3000/api/platform/storage/admin/cleanup-scope",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestId: "req_cleanup",
            dryRun: false,
          }),
        }
      )
    );
    const data = await response.json();
    const records = await db
      .select()
      .from(storageObject)
      .where(inArray(storageObject.id, [first.id, second.id]));

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.total).toBe(2);
    expect(data.deleted).toBe(2);
    expect(records.every((item) => item.status === "deleted")).toBe(true);
    expect(deleteObjectMock).toHaveBeenCalledTimes(2);
  });
});
