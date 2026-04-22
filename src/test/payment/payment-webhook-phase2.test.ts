import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createCreditPurchase } from "@/app/api/platform/payment/credit-purchase/route";
import { POST as postAlipayWebhook } from "@/app/api/webhooks/alipay/route";
import { POST as postWechatWebhook } from "@/app/api/webhooks/wechat-pay/route";
import { paymentIntent, salesOrder } from "@/db/schema";
import { PaymentProvider } from "@/features/payment/types";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  getUserCreditsState,
  testDb,
} from "../utils";

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

describe("Payment webhook phase 2", () => {
  it("微信支付回调应回写支付成功、落统一订单并发放积分", async () => {
    const user = await createTestUser({
      email: `1183989659+phase2-wechat-${Date.now()}@qq.com`,
      name: "微信支付测试用户",
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
            packageId: "standard",
            provider: PaymentProvider.WECHAT_PAY,
          }),
        }
      )
    );
    const created = await createResponse.json();

    const webhookResponse = await postWechatWebhook(
      new Request("http://localhost:3000/api/webhooks/wechat-pay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          out_trade_no: created.intent.outTradeNo,
          transaction_id: `wx_txn_${created.intent.id}`,
          trade_state: "SUCCESS",
          success_time: "2026-04-22T12:00:00Z",
        }),
      })
    );
    const webhookData = await webhookResponse.json();
    const [storedIntent] = await testDb
      .select()
      .from(paymentIntent)
      .where(eq(paymentIntent.id, created.intent.id))
      .limit(1);
    const orders = await testDb
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, user.id));
    const creditsState = await getUserCreditsState(user.id);

    expect(webhookResponse.status).toBe(200);
    expect(webhookData.code).toBe("SUCCESS");
    expect(storedIntent?.status).toBe("paid");
    expect(orders).toHaveLength(1);
    expect(orders[0]?.provider).toBe("wechat_pay");
    expect(creditsState.balance?.balance).toBe(8000);
  });

  it("支付宝重复回调不应重复发放积分或重复落单", async () => {
    const user = await createTestUser({
      email: `1183989659+phase2-alipay-${Date.now()}@qq.com`,
      name: "支付宝测试用户",
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

    const buildNotifyRequest = () =>
      new Request("http://localhost:3000/api/webhooks/alipay", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          out_trade_no: created.intent.outTradeNo as string,
          trade_no: `ali_trade_${created.intent.id}`,
          trade_status: "TRADE_SUCCESS",
          gmt_payment: "2026-04-22 20:00:00",
          total_amount: "3.00",
        }).toString(),
      });

    const firstResponse = await postAlipayWebhook(buildNotifyRequest());
    const secondResponse = await postAlipayWebhook(buildNotifyRequest());
    const orders = await testDb
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, user.id));
    const creditsState = await getUserCreditsState(user.id);

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toBe("success");
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.text()).toBe("success");
    expect(orders).toHaveLength(1);
    expect(orders[0]?.provider).toBe("alipay");
    expect(creditsState.balance?.balance).toBe(3000);
  });
});
