import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postBilling } from "@/app/api/platform/payment/subscription/contracts/[contractId]/bill/route";
import {
  DELETE as deleteContract,
  GET as getContract,
} from "@/app/api/platform/payment/subscription/contracts/[contractId]/route";
import { POST as createContract } from "@/app/api/platform/payment/subscription/contracts/route";
import { POST as postSubscriptionBillingWebhook } from "@/app/api/webhooks/alipay/subscription-billing/route";
import { POST as postSubscriptionContractWebhook } from "@/app/api/webhooks/alipay/subscription-contract/route";
import {
  salesOrder,
  subscription,
  subscriptionBilling,
  subscriptionContract,
} from "@/db/schema";
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

describe("Subscription alipay phase 7", () => {
  it("用户应能完成支付宝代扣签约、首期账单和订阅入账", async () => {
    const user = await createTestUser({
      email: `1183989659+phase7-alipay-${Date.now()}@qq.com`,
      name: "支付宝代扣用户",
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
            provider: "alipay",
            planId: "starter",
            interval: PlanInterval.YEAR,
          }),
        }
      )
    );
    const createData = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createData.success).toBe(true);
    expect(createData.contract.provider).toBe("alipay");

    const activateForm = new FormData();
    activateForm.set("out_agreement_no", createData.contract.id);
    activateForm.set("agreement_no", `ali_contract_${createData.contract.id}`);
    activateForm.set("status", "ACTIVE");
    const activateResponse = await postSubscriptionContractWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/alipay/subscription-contract",
        {
          method: "POST",
          body: activateForm,
        }
      )
    );
    const activateData = await activateResponse.json();
    expect(activateResponse.status).toBe(200);
    expect(activateData.contract.status).toBe("active");

    const queryResponse = await getContract(
      new Request(
        `http://localhost:3000/api/platform/payment/subscription/contracts/${createData.contract.id}`,
        {
          method: "GET",
        }
      ),
      {
        params: Promise.resolve({
          contractId: createData.contract.id as string,
        }),
      }
    );
    const queryData = await queryResponse.json();
    expect(queryResponse.status).toBe(200);
    expect(queryData.contract.providerContractId).toBe(
      `ali_contract_${createData.contract.id}`
    );

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

    const billingForm = new FormData();
    billingForm.set("out_trade_no", billData.billing.outTradeNo);
    billingForm.set("trade_no", `ali_trade_${billData.billing.id}`);
    billingForm.set("trade_status", "TRADE_SUCCESS");
    const billingResponse = await postSubscriptionBillingWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/alipay/subscription-billing",
        {
          method: "POST",
          body: billingForm,
        }
      )
    );
    const billingData = await billingResponse.json();
    expect(billingResponse.status).toBe(200);
    expect(billingData.success).toBe(true);

    const creditsState = await getUserCreditsState(user.id);
    expect(creditsState.balance?.balance).toBe(36000);

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
    expect(orders[0]?.provider).toBe("alipay");
    expect(orders[0]?.orderType).toBe("subscription");

    const cancelResponse = await deleteContract(
      new Request(
        `http://localhost:3000/api/platform/payment/subscription/contracts/${createData.contract.id}`,
        {
          method: "DELETE",
        }
      ),
      {
        params: Promise.resolve({
          contractId: createData.contract.id as string,
        }),
      }
    );
    const cancelData = await cancelResponse.json();
    expect(cancelResponse.status).toBe(200);
    expect(cancelData.contract.status).toBe("terminated");

    const [storedContract] = await testDb
      .select()
      .from(subscriptionContract)
      .where(eq(subscriptionContract.id, createData.contract.id))
      .limit(1);
    expect(storedContract?.status).toBe("terminated");
  });
});
