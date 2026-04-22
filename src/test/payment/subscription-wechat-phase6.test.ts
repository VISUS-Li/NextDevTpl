import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postBilling } from "@/app/api/platform/payment/subscription/contracts/[contractId]/bill/route";
import { GET as getContract } from "@/app/api/platform/payment/subscription/contracts/[contractId]/route";
import { POST as createContract } from "@/app/api/platform/payment/subscription/contracts/route";
import { POST as postSubscriptionBillingWebhook } from "@/app/api/webhooks/wechat-pay/subscription-billing/route";
import { POST as postSubscriptionContractWebhook } from "@/app/api/webhooks/wechat-pay/subscription-contract/route";
import { salesOrder, subscription, subscriptionBilling } from "@/db/schema";
import { PlanInterval } from "@/features/payment/types";
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

/**
 * 模拟接口登录态。
 */
function mockSession(user: {
  id: string;
  name: string;
  email: string;
  role?: "user" | "admin";
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

describe("Subscription wechat phase 6", () => {
  it("用户应能完成微信连续扣费签约、首期扣款和订阅入账", async () => {
    const user = await createTestUser({
      email: `1183989659+phase6-wechat-${Date.now()}@qq.com`,
      name: "微信连续扣费用户",
    });
    createdUserIds.push(user.id);
    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    });

    const createResponse = await createContract(
      new Request(
        "http://localhost:3000/api/platform/payment/subscription/contracts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "wechat_pay",
            planId: "starter",
            interval: PlanInterval.MONTH,
          }),
        }
      )
    );
    const createData = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createData.success).toBe(true);
    expect(createData.contract.provider).toBe("wechat_pay");
    expect(createData.contract.status).toBe("pending_sign");

    const detailResponse = await getContract(
      new Request(
        `http://localhost:3000/api/platform/payment/subscription/contracts/${createData.contract.id}`
      ),
      {
        params: Promise.resolve({
          contractId: createData.contract.id as string,
        }),
      }
    );
    const detailData = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detailData.contract.id).toBe(createData.contract.id);

    const activateResponse = await postSubscriptionContractWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/wechat-pay/subscription-contract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract_id: createData.contract.id,
            provider_contract_id: `wx_contract_${createData.contract.id}`,
            contract_status: "ACTIVE",
            external_user_id: user.id,
          }),
        }
      )
    );
    const activateData = await activateResponse.json();
    expect(activateResponse.status).toBe(200);
    expect(activateData.contract.status).toBe("active");

    const billResponse = await postBilling(
      new Request(
        `http://localhost:3000/api/platform/payment/subscription/contracts/${createData.contract.id}/bill`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({
          contractId: createData.contract.id as string,
        }),
      }
    );
    const billData = await billResponse.json();
    expect(billResponse.status).toBe(201);
    expect(billData.success).toBe(true);

    const billingWebhookResponse = await postSubscriptionBillingWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/wechat-pay/subscription-billing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            out_trade_no: billData.billing.outTradeNo,
            transaction_id: `wx_sub_pay_${billData.billing.id}`,
            trade_state: "SUCCESS",
          }),
        }
      )
    );
    const billingWebhookData = await billingWebhookResponse.json();

    expect(billingWebhookResponse.status).toBe(200);
    expect(billingWebhookData.success).toBe(true);

    const creditsState = await getUserCreditsState(user.id);
    expect(creditsState.balance?.balance).toBe(3000);

    const [storedSubscription] = await testDb
      .select()
      .from(subscription)
      .where(eq(subscription.userId, user.id))
      .limit(1);
    expect(storedSubscription?.status).toBe("active");

    const [storedBilling] = await testDb
      .select()
      .from(subscriptionBilling)
      .where(eq(subscriptionBilling.id, billData.billing.id))
      .limit(1);
    expect(storedBilling?.status).toBe("paid");

    const orders = await testDb
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, user.id));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.orderType).toBe("subscription");
  });
});
