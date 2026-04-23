import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH as patchSubscriptionContract } from "@/app/api/platform/payment/subscription/contracts/[contractId]/route";
import { POST as postBilling } from "@/app/api/platform/payment/subscription/contracts/[contractId]/bill/route";
import { POST as postWechatSubscriptionBillingWebhook } from "@/app/api/webhooks/wechat-pay/subscription-billing/route";
import { POST as refundAdminPayment } from "@/app/api/platform/payments/admin/refund/route";
import {
  salesAfterSalesEvent,
  salesOrder,
  salesOrderItem,
  subscription,
  subscriptionBilling,
  subscriptionContract,
} from "@/db/schema";
import { grantCredits } from "@/features/credits/core";
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

describe("Subscription phase 11", () => {
  it("用户安排套餐变更后应在下个账期生效", async () => {
    const user = await createTestUser({
      email: `1183989659+phase11-plan-${Date.now()}@qq.com`,
      name: "阶段11套餐用户",
    });
    createdUserIds.push(user.id);

    const contractId = `phase11_contract_${Date.now()}`;
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
      nextBillingAt: new Date("2026-04-01T00:00:00.000Z"),
      metadata: {
        baseUrl: "http://localhost:3000",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    });

    const patchResponse = await patchSubscriptionContract(
      new Request(
        `http://localhost:3000/api/platform/payment/subscription/contracts/${contractId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: "pro",
            interval: PlanInterval.YEAR,
          }),
        }
      ),
      {
        params: Promise.resolve({ contractId }),
      }
    );
    const patchPayload = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchPayload.contract.pendingPlanId).toBe("pro");
    expect(patchPayload.contract.pendingInterval).toBe(PlanInterval.YEAR);

    const billResponse = await postBilling(
      new Request(
        `http://localhost:3000/api/platform/payment/subscription/contracts/${contractId}/bill`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({ contractId }),
      }
    );
    const billPayload = await billResponse.json();

    expect(billResponse.status).toBe(201);
    expect(billPayload.billing.planId).toBe("pro");
    expect(billPayload.billing.priceId).toBe("pro_yearly");

    const webhookResponse = await postWechatSubscriptionBillingWebhook(
      new Request(
        "http://localhost:3000/api/webhooks/wechat-pay/subscription-billing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            out_trade_no: billPayload.billing.outTradeNo,
            transaction_id: `phase11_pay_${billPayload.billing.id}`,
            trade_state: "SUCCESS",
          }),
        }
      )
    );
    const webhookPayload = await webhookResponse.json();

    expect(webhookResponse.status).toBe(200);
    expect(webhookPayload.success).toBe(true);

    const [updatedContract] = await testDb
      .select()
      .from(subscriptionContract)
      .where(eq(subscriptionContract.id, contractId));

    expect(updatedContract?.planId).toBe("pro");
    expect(updatedContract?.billingInterval).toBe(PlanInterval.YEAR);
    expect(updatedContract?.metadata?.pendingPlanChange).toBeUndefined();
  });

  it("管理员应能对订阅订单做全额退款并暂停协议", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+phase11-admin-${Date.now()}@qq.com`,
      name: "阶段11退款管理员",
      role: "admin",
    });
    const normalUser = await createTestUser({
      email: `1183989659+phase11-refund-${Date.now()}@qq.com`,
      name: "阶段11退款用户",
    });
    createdUserIds.push(adminUser.id, normalUser.id);

    const contractId = `phase11_refund_contract_${Date.now()}`;
    const billingId = `phase11_refund_billing_${Date.now()}`;
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await grantCredits({
      userId: normalUser.id,
      amount: 1,
      sourceType: "bonus",
      debitAccount: "SYSTEM:phase11",
      transactionType: "admin_grant",
      sourceRef: `phase11_refund_credit_${Date.now()}`,
      description: "阶段11退款前置积分",
    });
    await testDb.insert(subscription).values({
      id: crypto.randomUUID(),
      userId: normalUser.id,
      subscriptionId: `ali_contract_${contractId}`,
      priceId: "starter_month",
      status: "active",
      currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
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
      outTradeNo: `phase11_refund_trade_${Date.now()}`,
      providerOrderId: `phase11_refund_trade_${Date.now()}`,
      providerPaymentId: `phase11_refund_pay_${Date.now()}`,
      status: "paid",
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.insert(salesOrder).values({
      id: orderId,
      userId: normalUser.id,
      provider: "alipay",
      providerOrderId: `phase11_provider_order_${orderId}`,
      providerSubscriptionId: `ali_contract_${contractId}`,
      providerPaymentId: `phase11_provider_pay_${orderId}`,
      orderType: "subscription",
      status: "paid",
      afterSalesStatus: "none",
      currency: "CNY",
      grossAmount: 500,
      paidAt: new Date(),
      eventTime: new Date(),
      eventType: "alipay.subscription.billing.paid",
      eventIdempotencyKey: `phase11_refund_order_${orderId}`,
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
      metadata: {
        contractId,
        billingId,
        credits: 1,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const response = await refundAdminPayment(
      new Request("http://localhost:3000/api/platform/payments/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          amount: 500,
          reason: "订阅退款测试",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.result.refundedCredits).toBe(1);

    const [updatedBilling] = await testDb
      .select()
      .from(subscriptionBilling)
      .where(eq(subscriptionBilling.id, billingId));
    const [updatedContract] = await testDb
      .select()
      .from(subscriptionContract)
      .where(eq(subscriptionContract.id, contractId));
    const [afterSalesEvent] = await testDb
      .select()
      .from(salesAfterSalesEvent)
      .where(eq(salesAfterSalesEvent.orderId, orderId));

    expect(updatedBilling?.status).toBe("refunded");
    expect(updatedContract?.status).toBe("paused");
    expect(afterSalesEvent?.eventType).toBe("refunded");
  });
});
