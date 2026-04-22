import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createCreditPurchase } from "@/app/api/platform/payment/credit-purchase/route";
import { GET as getPaymentIntent } from "@/app/api/platform/payment/intents/[intentId]/route";
import { POST as postWechatWebhook } from "@/app/api/webhooks/wechat-pay/route";
import { PaymentProvider } from "@/features/payment/types";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser } from "../utils";

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

describe("Payment phase 3 acceptance", () => {
  it("用户接口链路应完成创建支付单、支付成功回调和已支付状态读取", async () => {
    const user = await createTestUser({
      email: `1183989659+phase3-${Date.now()}@qq.com`,
      name: "最终验收用户",
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
            packageId: "premium",
            provider: PaymentProvider.WECHAT_PAY,
          }),
        }
      )
    );
    const created = await createResponse.json();

    const pendingResponse = await getPaymentIntent(
      new Request(
        `http://localhost:3000/api/platform/payment/intents/${created.intent.id}`
      ),
      {
        params: Promise.resolve({
          intentId: created.intent.id as string,
        }),
      }
    );
    const pending = await pendingResponse.json();

    expect(pending.intent.status).toBe("pending");

    await postWechatWebhook(
      new Request("http://localhost:3000/api/webhooks/wechat-pay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          out_trade_no: created.intent.outTradeNo,
          transaction_id: `wx_accept_${created.intent.id}`,
          trade_state: "SUCCESS",
        }),
      })
    );

    const paidResponse = await getPaymentIntent(
      new Request(
        `http://localhost:3000/api/platform/payment/intents/${created.intent.id}`
      ),
      {
        params: Promise.resolve({
          intentId: created.intent.id as string,
        }),
      }
    );
    const paid = await paidResponse.json();

    expect(paidResponse.status).toBe(200);
    expect(paid.success).toBe(true);
    expect(paid.intent.status).toBe("paid");
    expect(paid.intent.credits).toBe(20000);
  });
});
