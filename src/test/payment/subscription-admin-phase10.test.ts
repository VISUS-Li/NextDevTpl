import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAdminPaymentDetail } from "@/app/api/platform/payments/admin/[orderId]/route";
import { POST as syncSubscriptionBilling } from "@/app/api/platform/payments/admin/subscriptions/billings/[billingId]/sync/route";
import { POST as retrySubscriptionBilling } from "@/app/api/platform/payments/admin/subscriptions/billings/[billingId]/retry/route";
import { POST as syncSubscriptionContract } from "@/app/api/platform/payments/admin/subscriptions/contracts/[contractId]/sync/route";
import { POST as postWechatSubscriptionBillingWebhook } from "@/app/api/webhooks/wechat-pay/subscription-billing/route";
import {
  salesOrder,
  salesOrderItem,
  subscriptionBilling,
  subscriptionContract,
} from "@/db/schema";
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

describe("Subscription admin phase 10", () => {
  it("失败回调连续出现三次后应暂停协议", async () => {
    const user = await createTestUser({
      email: `1183989659+phase10-user-${Date.now()}@qq.com`,
      name: "阶段10普通用户",
    });
    createdUserIds.push(user.id);

    const contractId = `phase10_contract_${Date.now()}`;
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
      nextBillingAt: new Date(),
      metadata: {
        baseUrl: "http://localhost:3000",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const periodStart = new Date("2026-01-01T00:00:00.000Z");
    for (let index = 1; index <= 2; index += 1) {
      await testDb.insert(subscriptionBilling).values({
        id: `phase10_failed_${index}_${Date.now()}`,
        contractId,
        userId: user.id,
        provider: "wechat_pay",
        planId: "starter",
        priceId: "starter_month",
        billingSequence: index,
        periodStart: new Date(periodStart.getTime() + (index - 1) * 86_400_000),
        periodEnd: new Date(periodStart.getTime() + index * 86_400_000),
        amount: 500,
        currency: "CNY",
        outTradeNo: `phase10_failed_trade_${index}_${Date.now()}`,
        status: "failed",
        failedAt: new Date(),
        failureReason: "USERPAYING",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const currentBillingId = `phase10_failed_current_${Date.now()}`;
    const currentOutTradeNo = `phase10_failed_trade_current_${Date.now()}`;
    await testDb.insert(subscriptionBilling).values({
      id: currentBillingId,
      contractId,
      userId: user.id,
      provider: "wechat_pay",
      planId: "starter",
      priceId: "starter_month",
      billingSequence: 3,
      periodStart: new Date("2026-01-03T00:00:00.000Z"),
      periodEnd: new Date("2026-02-03T00:00:00.000Z"),
      amount: 500,
      currency: "CNY",
      outTradeNo: currentOutTradeNo,
      status: "processing",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await postWechatSubscriptionBillingWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/wechat-pay/subscription-billing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            out_trade_no: currentOutTradeNo,
            trade_state: "CLOSED",
          }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);

    const [updatedBilling] = await testDb
      .select()
      .from(subscriptionBilling)
      .where(eq(subscriptionBilling.id, currentBillingId));
    const [updatedContract] = await testDb
      .select()
      .from(subscriptionContract)
      .where(eq(subscriptionContract.id, contractId));

    expect(updatedBilling?.status).toBe("failed");
    expect(updatedBilling?.failureReason).toBe("CLOSED");
    expect(updatedContract?.status).toBe("paused");
  });

  it("管理员应能在支付详情里看到协议和账单排障信息", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+phase10-admin-${Date.now()}@qq.com`,
      name: "阶段10管理员",
      role: "admin",
    });
    const normalUser = await createTestUser({
      email: `1183989659+phase10-detail-${Date.now()}@qq.com`,
      name: "阶段10详情用户",
    });
    createdUserIds.push(adminUser.id, normalUser.id);

    const contractId = `phase10_detail_contract_${Date.now()}`;
    const billingId = `phase10_detail_billing_${Date.now()}`;
    const orderId = crypto.randomUUID();
    const orderItemId = crypto.randomUUID();

    await testDb.insert(subscriptionContract).values({
      id: contractId,
      userId: normalUser.id,
      provider: "alipay",
      planId: "starter",
      priceId: "starter_month",
      billingInterval: PlanInterval.MONTH,
      currency: "CNY",
      amount: 500,
      providerContractId: `ali_contract_${contractId}`,
      status: "active",
      nextBillingAt: new Date("2026-05-01T00:00:00.000Z"),
      metadata: {
        providerQuery: {
          mock: true,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.insert(subscriptionBilling).values({
      id: billingId,
      contractId,
      userId: normalUser.id,
      provider: "alipay",
      planId: "starter",
      priceId: "starter_month",
      billingSequence: 1,
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      amount: 500,
      currency: "CNY",
      outTradeNo: `phase10_detail_trade_${Date.now()}`,
      providerOrderId: `phase10_detail_trade_${Date.now()}`,
      status: "failed",
      failedAt: new Date(),
      failureReason: "mock failed",
      metadata: {
        providerFailure: {
          code: "mock_failed",
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.insert(salesOrder).values({
      id: orderId,
      userId: normalUser.id,
      provider: "alipay",
      providerOrderId: `provider_order_${orderId}`,
      providerSubscriptionId: `ali_contract_${contractId}`,
      orderType: "subscription",
      status: "paid",
      afterSalesStatus: "none",
      currency: "CNY",
      grossAmount: 500,
      paidAt: new Date(),
      eventTime: new Date(),
      eventType: "alipay.subscription.billing.paid",
      eventIdempotencyKey: `phase10_detail_order_${orderId}`,
      metadata: {
        contractId,
        billingId,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.insert(salesOrderItem).values({
      id: orderItemId,
      orderId,
      productType: "subscription",
      productId: "starter",
      priceId: "starter_month",
      planId: "starter",
      quantity: 1,
      grossAmount: 500,
      netAmount: 500,
      commissionBaseAmount: 500,
      refundableAmount: 500,
      refundedAmount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const response = await getAdminPaymentDetail(
      new Request(`http://localhost:3000/api/platform/payments/admin/${orderId}`),
      {
        params: Promise.resolve({ orderId }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.detail.recurringContract.id).toBe(contractId);
    expect(payload.detail.recurringBilling.id).toBe(billingId);
    expect(payload.detail.recurringBilling.failureReason).toBe("mock failed");
  });

  it("管理员应能同步协议和补扣失败账单", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+phase10-sync-admin-${Date.now()}@qq.com`,
      name: "阶段10同步管理员",
      role: "admin",
    });
    const normalUser = await createTestUser({
      email: `1183989659+phase10-sync-user-${Date.now()}@qq.com`,
      name: "阶段10同步用户",
    });
    createdUserIds.push(adminUser.id, normalUser.id);

    const contractId = `phase10_sync_contract_${Date.now()}`;
    const billingId = `phase10_sync_billing_${Date.now()}`;
    await testDb.insert(subscriptionContract).values({
      id: contractId,
      userId: normalUser.id,
      provider: "wechat_pay",
      planId: "starter",
      priceId: "starter_month",
      billingInterval: PlanInterval.MONTH,
      currency: "CNY",
      amount: 500,
      providerContractId: `wx_contract_${contractId}`,
      status: "pending_sign",
      nextBillingAt: null,
      metadata: {
        baseUrl: "http://localhost:3000",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.insert(subscriptionBilling).values({
      id: billingId,
      contractId,
      userId: normalUser.id,
      provider: "wechat_pay",
      planId: "starter",
      priceId: "starter_month",
      billingSequence: 1,
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      amount: 500,
      currency: "CNY",
      outTradeNo: `phase10_sync_trade_${Date.now()}`,
      status: "failed",
      failedAt: new Date(),
      failureReason: "mock failed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const syncContractResponse = await syncSubscriptionContract(
      new Request(
        `http://localhost:3000/api/platform/payments/admin/subscriptions/contracts/${contractId}/sync`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({ contractId }),
      }
    );
    const syncContractPayload = await syncContractResponse.json();

    expect(syncContractResponse.status).toBe(200);
    expect(syncContractPayload.contract.status).toBe("active");

    const syncBillingResponse = await syncSubscriptionBilling(
      new Request(
        `http://localhost:3000/api/platform/payments/admin/subscriptions/billings/${billingId}/sync`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({ billingId }),
      }
    );
    const syncBillingPayload = await syncBillingResponse.json();

    expect(syncBillingResponse.status).toBe(200);
    expect(syncBillingPayload.billing.status).toBe("failed");

    const retryResponse = await retrySubscriptionBilling(
      new Request(
        `http://localhost:3000/api/platform/payments/admin/subscriptions/billings/${billingId}/retry`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({ billingId }),
      }
    );
    const retryPayload = await retryResponse.json();

    expect(retryResponse.status).toBe(200);
    expect(retryPayload.billing.status).toBe("processing");
    expect(retryPayload.billing.providerOrderId).toBe(
      retryPayload.billing.outTradeNo
    );
  });
});
