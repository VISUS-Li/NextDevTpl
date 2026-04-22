import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createCreditPurchase } from "@/app/api/platform/payment/credit-purchase/route";
import { GET as getPaymentIntent } from "@/app/api/platform/payment/intents/[intentId]/route";
import { paymentIntent } from "@/db/schema";
import { PaymentProvider } from "@/features/payment/types";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser, testDb } from "../utils";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("PAYMENT_MOCK_MODE", "true");
});

/**
 * 模拟登录用户，按接口调用方式测试支付单创建。
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

describe("Credit purchase payment intent phase 1", () => {
  it("用户调用创建接口后应生成微信支付待支付单", async () => {
    const user = await createTestUser({
      email: `1183989659+wechat-${Date.now()}@qq.com`,
      name: "支付测试用户",
    });
    createdUserIds.push(user.id);
    mockSession(user);

    const response = await createCreditPurchase(
      new Request(
        "http://localhost:3000/api/platform/payment/credit-purchase",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
          },
          body: JSON.stringify({
            packageId: "standard",
            provider: PaymentProvider.WECHAT_PAY,
          }),
        }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.intent.provider).toBe("wechat_pay");
    expect(data.intent.displayMode).toBe("qrcode");
    expect(data.intent.status).toBe("pending");
    expect(data.intent.qrCodeUrl).toContain("weixin://wxpay/mock/");

    const [storedIntent] = await testDb
      .select()
      .from(paymentIntent)
      .where(eq(paymentIntent.id, data.intent.id))
      .limit(1);
    expect(storedIntent?.userId).toBe(user.id);
    expect(storedIntent?.packageId).toBe("standard");
    expect(storedIntent?.credits).toBe(8000);
  });

  it("用户调用详情接口时应拿到自己的支付单摘要", async () => {
    const user = await createTestUser({
      email: `1183989659+alipay-${Date.now()}@qq.com`,
      name: "支付测试用户支付宝",
    });
    createdUserIds.push(user.id);
    mockSession(user);

    const createResponse = await createCreditPurchase(
      new Request(
        "http://localhost:3000/api/platform/payment/credit-purchase",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            packageId: "starter",
            provider: PaymentProvider.ALIPAY,
          }),
        }
      )
    );
    const created = await createResponse.json();

    const detailResponse = await getPaymentIntent(
      new Request(
        `http://localhost:3000/api/platform/payment/intents/${created.intent.id}`
      ),
      {
        params: Promise.resolve({
          intentId: created.intent.id as string,
        }),
      }
    );
    const detail = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detail.success).toBe(true);
    expect(detail.intent.id).toBe(created.intent.id);
    expect(detail.intent.provider).toBe("alipay");
    expect(detail.intent.checkoutUrl).toContain(
      "https://mock-pay.tripai.local/alipay/"
    );
  });
});
