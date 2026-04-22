import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createCreditPurchase } from "@/app/api/platform/payment/credit-purchase/route";
import { POST as postAdminRefund } from "@/app/api/platform/payments/admin/refund/route";
import { POST as postWechatWebhook } from "@/app/api/webhooks/wechat-pay/route";
import { paymentIntent, salesAfterSalesEvent, salesOrder } from "@/db/schema";
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

describe("Admin payment phase 5 refund", () => {
  it("管理员应能按接口方式发起积分包全额退款", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+phase5-admin-${Date.now()}@qq.com`,
      name: "支付退款管理员",
      role: "admin",
    });
    const normalUser = await createTestUser({
      email: `1183989659+phase5-user-${Date.now()}@qq.com`,
      name: "支付退款普通用户",
    });
    createdUserIds.push(adminUser.id, normalUser.id);

    mockSession({
      id: normalUser.id,
      name: normalUser.name,
      email: normalUser.email,
      role: "user",
    });

    const createResponse = await createCreditPurchase(
      new Request(
        "http://localhost:3000/api/platform/payment/credit-purchase",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            packageId: "starter",
            provider: PaymentProvider.WECHAT_PAY,
          }),
        }
      )
    );
    const created = await createResponse.json();

    await postWechatWebhook(
      new Request("http://localhost:3000/api/webhooks/wechat-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          out_trade_no: created.intent.outTradeNo,
          transaction_id: `wx_refund_phase5_${created.intent.id}`,
          trade_state: "SUCCESS",
        }),
      })
    );

    const creditsBeforeRefund = await getUserCreditsState(normalUser.id);
    expect(creditsBeforeRefund.balance?.balance).toBe(3000);

    const [order] = await testDb
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.userId, normalUser.id))
      .limit(1);
    expect(order).toBeDefined();
    if (!order) {
      throw new Error("测试订单不存在");
    }
    const orderId = order.id;

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const refundResponse = await postAdminRefund(
      new Request("http://localhost:3000/api/platform/payments/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          amount: created.intent.amount,
          reason: "测试全额退款",
        }),
      })
    );
    const refundData = await refundResponse.json();

    expect(refundResponse.status).toBe(201);
    expect(refundData.success).toBe(true);
    expect(refundData.result.refundAmount).toBe(created.intent.amount);
    expect(refundData.result.refundedCredits).toBe(3000);

    const creditsAfterRefund = await getUserCreditsState(normalUser.id);
    expect(creditsAfterRefund.balance?.balance).toBe(0);

    const [updatedOrder] = await testDb
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.id, orderId))
      .limit(1);
    expect(updatedOrder?.afterSalesStatus).toBe("refunded");
    expect(updatedOrder?.status).toBe("closed");

    const [updatedIntent] = await testDb
      .select()
      .from(paymentIntent)
      .where(eq(paymentIntent.id, created.intent.id))
      .limit(1);
    expect(updatedIntent?.status).toBe("refunded");

    const afterSales = await testDb
      .select()
      .from(salesAfterSalesEvent)
      .where(eq(salesAfterSalesEvent.orderId, orderId));
    expect(afterSales).toHaveLength(1);
    expect(afterSales[0]?.eventType).toBe("refunded");
  });
});
