import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as runRecurringBillingJob } from "@/app/api/jobs/payment/subscription-recurring/route";
import { POST as postBilling } from "@/app/api/platform/payment/subscription/contracts/[contractId]/bill/route";
import { POST as createContract } from "@/app/api/platform/payment/subscription/contracts/route";
import { POST as postSubscriptionContractWebhook } from "@/app/api/webhooks/wechat-pay/subscription-contract/route";
import { subscriptionBilling, subscriptionContract } from "@/db/schema";
import { PlanInterval } from "@/features/payment/types";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
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

describe("Subscription recurring phase 9", () => {
  it("手工触发账单时应回写渠道发单结果", async () => {
    const user = await createTestUser({
      email: `1183989659+phase9-bill-${Date.now()}@qq.com`,
      name: "阶段9账单用户",
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

    await postSubscriptionContractWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/wechat-pay/subscription-contract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract_id: createData.contract.id,
            provider_contract_id: `wx_contract_${createData.contract.id}`,
            contract_status: "ACTIVE",
          }),
        }
      )
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
    expect(billData.billing.providerOrderId).toBe(billData.billing.outTradeNo);
    expect(
      billData.billing.metadata?.providerDispatch?.mock
    ).toBe(true);
  });

  it("定时任务应扫描到期协议并生成账单", async () => {
    const user = await createTestUser({
      email: `1183989659+phase9-job-${Date.now()}@qq.com`,
      name: "阶段9定时任务用户",
    });
    createdUserIds.push(user.id);

    const contractId = `contract_job_${Date.now()}`;
    await testDb.insert(subscriptionContract).values({
      id: contractId,
      userId: user.id,
      provider: "wechat_pay",
      planId: "starter",
      priceId: "starter_month",
      billingInterval: PlanInterval.MONTH,
      currency: "CNY",
      amount: 500,
      providerContractId: `wx_contract_${contractId}`,
      status: "active",
      nextBillingAt: new Date(Date.now() - 60_000),
      metadata: {
        baseUrl: "http://localhost:3000",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.stubEnv("CRON_SECRET", "cron_secret_phase9");
    const response = await runRecurringBillingJob(
      new Request(
        "http://localhost:3000/api/jobs/payment/subscription-recurring?limit=10",
        {
          method: "POST",
          headers: {
            authorization: "Bearer cron_secret_phase9",
          },
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.processed).toBeGreaterThanOrEqual(1);

    const rows = await testDb
      .select()
      .from(subscriptionBilling)
      .where(eq(subscriptionBilling.contractId, contractId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerOrderId).toBe(rows[0]?.outTradeNo);
  });
});
