/**
 * Platform API 集成测试
 *
 * 使用模拟登录态和真实测试数据库，验证 RedInk 接平台时依赖的最小 API。
 */

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as postCreditsCheck } from "@/app/api/platform/credits/check/route";
import { POST as postCreditsConsume } from "@/app/api/platform/credits/consume/route";
import { GET as getPlatformSession } from "@/app/api/platform/session/route";
import { POST as postPresignedImage } from "@/app/api/platform/storage/presigned-image/route";
import { db } from "@/db";
import { creditsTransaction } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestSubscription,
  createTestUser,
  createTestUserWithCredits,
  getUserCreditsState,
} from "../utils";

vi.mock("@/features/storage/providers", () => ({
  getStorageProvider: () => ({
    getSignedUploadUrl: vi.fn(
      async (key: string, bucket: string) =>
        `https://storage.test/${bucket}/${key}`
    ),
    getPublicUrl: vi.fn(
      (key: string, bucket: string) => `https://assets.test/${bucket}/${key}`
    ),
  }),
}));

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

/**
 * 模拟已登录请求
 */
function mockSession(user: {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string;
}) {
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

describe("Platform API", () => {
  it("session 接口应返回当前用户、套餐和积分", async () => {
    const creditsUser = await createTestUserWithCredits({
      initialCredits: 320,
    });
    createdUserIds.push(creditsUser.user.id);
    await createTestSubscription({
      userId: creditsUser.user.id,
      priceId:
        process.env.NEXT_PUBLIC_CREEM_PRICE_PRO_MONTHLY || "price_pro_monthly",
      status: "active",
    });

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
      role: "user",
    });

    const response = await getPlatformSession(
      new Request("http://localhost:3000/api/platform/session")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.id).toBe(creditsUser.user.id);
    expect(data.credits.balance).toBe(520);
    expect(data.plan.hasActiveSubscription).toBe(true);
  });

  it("credits/check 接口应按当前余额返回是否可用", async () => {
    const creditsUser = await createTestUserWithCredits({
      initialCredits: 5,
    });
    createdUserIds.push(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const response = await postCreditsCheck(
      new Request("http://localhost:3000/api/platform/credits/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: 3 }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.available).toBe(true);
    expect(data.currentBalance).toBe(205);
  });

  it("credits/consume 接口应完成扣费并写入交易记录", async () => {
    const creditsUser = await createTestUserWithCredits({
      initialCredits: 8,
    });
    createdUserIds.push(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const response = await postCreditsConsume(
      new Request("http://localhost:3000/api/platform/credits/consume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: 3,
          serviceName: "redink_outline_generation",
          metadata: {
            tool: "redink",
            phase: "outline",
          },
        }),
      })
    );
    const data = await response.json();
    const creditsState = await getUserCreditsState(creditsUser.user.id);
    const transactions = await db
      .select()
      .from(creditsTransaction)
      .where(eq(creditsTransaction.userId, creditsUser.user.id));

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.remainingBalance).toBe(205);
    expect(creditsState.balance?.balance).toBe(205);
    expect(
      transactions.some(
        (item) =>
          item.type === "consumption" &&
          item.debitAccount === `WALLET:${creditsUser.user.id}` &&
          item.creditAccount === "SERVICE:redink_outline_generation"
      )
    ).toBe(true);
  });

  it("presigned-image 接口应返回图片上传地址", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    const response = await postPresignedImage(
      new Request(
        "http://localhost:3000/api/platform/storage/presigned-image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: "product.png",
            contentType: "image/png",
            fileSize: 1024,
          }),
        }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.key).toContain(`/`);
    expect(data.contentType).toBe("image/png");
    expect(data.uploadUrl).toContain("https://storage.test/");
  });
});
