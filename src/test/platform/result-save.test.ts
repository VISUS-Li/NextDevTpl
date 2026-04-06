/**
 * 平台结果保存测试
 */

import { afterAll, describe, expect, it, vi } from "vitest";

import { POST as savePlatformResult } from "@/app/api/platform/results/save/route";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser } from "../utils";

const createdUserIds: string[] = [];
const putObjectMock = vi.fn(async () => undefined);

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    putObject: putObjectMock,
  }),
}));

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

describe("Platform Result Save API", () => {
  it("应将工具结果写入平台存储", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

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

    const response = await savePlatformResult(
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
            titles: ["标题1"],
          },
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.key).toContain(`redink/results/${user.id}/`);
    expect(putObjectMock).toHaveBeenCalledOnce();
  });
});
