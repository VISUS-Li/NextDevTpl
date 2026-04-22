import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createCreditPurchase } from "@/app/api/platform/payment/credit-purchase/route";
import { GET as getAdminPaymentDetail } from "@/app/api/platform/payments/admin/[orderId]/route";
import { GET as getAdminPayments } from "@/app/api/platform/payments/admin/route";
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

describe("Admin payment phase 4", () => {
  it("管理员应能按接口方式查询支付列表和详情", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+phase4-admin-${Date.now()}@qq.com`,
      name: "支付后台管理员",
      role: "admin",
    });
    const normalUser = await createTestUser({
      email: `1183989659+phase4-user-${Date.now()}@qq.com`,
      name: "支付后台普通用户",
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
            packageId: "standard",
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
          transaction_id: `wx_admin_phase4_${created.intent.id}`,
          trade_state: "SUCCESS",
        }),
      })
    );

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const listResponse = await getAdminPayments(
      new Request(
        `http://localhost:3000/api/platform/payments/admin?query=${encodeURIComponent(
          normalUser.email
        )}&provider=wechat_pay`
      )
    );
    const listData = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listData.success).toBe(true);
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0]?.userEmail).toBe(normalUser.email);
    expect(listData.items[0]?.provider).toBe("wechat_pay");
    expect(listData.items[0]?.orderType).toBe("credit_purchase");

    const detailResponse = await getAdminPaymentDetail(
      new Request(
        `http://localhost:3000/api/platform/payments/admin/${listData.items[0].id}`
      ),
      {
        params: Promise.resolve({
          orderId: listData.items[0].id as string,
        }),
      }
    );
    const detailData = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailData.success).toBe(true);
    expect(detailData.detail.order.userEmail).toBe(normalUser.email);
    expect(detailData.detail.paymentIntent.outTradeNo).toBe(
      created.intent.outTradeNo
    );
    expect(detailData.detail.items[0]?.productType).toBe("credit_package");
  });
});
