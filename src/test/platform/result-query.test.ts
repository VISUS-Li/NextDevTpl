/**
 * 平台结果查询测试
 */

import { afterAll, describe, expect, it, vi } from "vitest";

import { GET as getPlatformResults } from "@/app/api/platform/results/route";
import { GET as getPlatformResultDetail } from "@/app/api/platform/results/detail/route";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser } from "../utils";

const createdUserIds: string[] = [];
const listObjectsMock = vi.fn(async () => [
  {
    key: "redink/results/user_1/product_copy_generation_a.json",
    lastModified: new Date("2026-04-06T12:00:00.000Z"),
    size: 512,
  },
]);
const getObjectMock = vi.fn(async () =>
  Buffer.from(
    JSON.stringify({
      userId: "user_1",
      tool: "redink",
      type: "product_copy_generation",
      savedAt: "2026-04-06T12:00:00.000Z",
      payload: {
        product_info: {
          product_name: "测试水杯",
        },
        copy_result: {
          titles: ["通勤女孩都在回购的水杯"],
          copywriting: "这只杯子真的很适合通勤使用",
          tags: ["通勤好物"],
        },
      },
    })
  )
);

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    listObjects: listObjectsMock,
    getObject: getObjectMock,
  }),
}));

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

describe("Platform Result Query API", () => {
  it("results 接口应返回当前用户的结果列表", async () => {
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
      user: {
        ...user,
        id: "user_1",
      },
    } as never);

    const response = await getPlatformResults(
      new Request(
        "http://localhost:3000/api/platform/results?tool=redink&type=product_copy_generation"
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("测试水杯");
    expect(listObjectsMock).toHaveBeenCalledOnce();
  });

  it("results/detail 接口应返回指定结果详情", async () => {
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
      user: {
        ...user,
        id: "user_1",
      },
    } as never);

    const response = await getPlatformResultDetail(
      new Request(
        "http://localhost:3000/api/platform/results/detail?key=redink/results/user_1/product_copy_generation_a.json"
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.result.payload.product_info.product_name).toBe("测试水杯");
    expect(data.result.payload.copy_result.titles[0]).toBe(
      "通勤女孩都在回购的水杯"
    );
  });
});
