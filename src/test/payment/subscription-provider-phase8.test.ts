import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseAlipayRecurringBillingNotification,
  parseAlipayRecurringContractNotification,
  parseWechatRecurringBillingNotification,
  parseWechatRecurringContractNotification,
} from "@/features/payment/recurring-provider-notify";
import {
  createRecurringProviderSigningUrl,
  queryRecurringProviderContract,
} from "@/features/payment/recurring-provider-service";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Subscription provider phase 8", () => {
  it("应能在 mock 模式下生成微信和支付宝签约链接", async () => {
    vi.stubEnv("PAYMENT_MOCK_MODE", "true");

    const wechatUrl = await createRecurringProviderSigningUrl({
      contract: {
        id: "contract_wechat_1",
        provider: "wechat_pay",
        planId: "starter",
        billingInterval: "month",
        providerContractId: null,
        providerPlanId: null,
        metadata: null,
      },
      baseUrl: "https://tripai.test",
    });
    const alipayUrl = await createRecurringProviderSigningUrl({
      contract: {
        id: "contract_alipay_1",
        provider: "alipay",
        planId: "pro",
        billingInterval: "year",
        providerContractId: null,
        providerPlanId: null,
        metadata: null,
      },
      baseUrl: "https://tripai.test",
    });

    expect(wechatUrl).toContain("wechatContract=contract_wechat_1");
    expect(alipayUrl).toContain("alipayContract=contract_alipay_1");
  });

  it("应能在真实模式下生成支付宝签约链接", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    vi.stubEnv("PAYMENT_MOCK_MODE", "false");
    vi.stubEnv("ALIPAY_APP_ID", "test_app_id");
    vi.stubEnv(
      "ALIPAY_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    );

    const url = await createRecurringProviderSigningUrl({
      contract: {
        id: "contract_alipay_real_1",
        provider: "alipay",
        planId: "starter",
        billingInterval: "month",
        providerContractId: null,
        providerPlanId: null,
        metadata: null,
      },
      baseUrl: "https://tripai.test",
    });

    expect(url).toContain("method=alipay.user.agreement.page.sign");
    expect(url).toContain("out_agreement_no");
  });

  it("应能在 mock 模式下查询签约状态", async () => {
    vi.stubEnv("PAYMENT_MOCK_MODE", "true");

    const active = await queryRecurringProviderContract({
      id: "contract_active_1",
      provider: "alipay",
      planId: "starter",
      billingInterval: "month",
      providerContractId: "agreement_active_1",
      providerPlanId: null,
      metadata: null,
    });
    const pending = await queryRecurringProviderContract({
      id: "contract_pending_1",
      provider: "wechat_pay",
      planId: "starter",
      billingInterval: "month",
      providerContractId: null,
      providerPlanId: null,
      metadata: null,
    });

    expect(active.status).toBe("active");
    expect(pending.status).toBe("pending_sign");
  });

  it("应能解析 mock 模式下的连续扣费回调", async () => {
    vi.stubEnv("PAYMENT_MOCK_MODE", "true");

    const alipayContract = await parseAlipayRecurringContractNotification(
      new Request("http://localhost/api/webhooks/alipay/subscription-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          out_agreement_no: "contract_alipay_2",
          agreement_no: "agreement_alipay_2",
          status: "ACTIVE",
          external_logon_id: "user_alipay_2",
        }),
      })
    );
    const alipayBilling = await parseAlipayRecurringBillingNotification(
      new Request("http://localhost/api/webhooks/alipay/subscription-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          out_trade_no: "trade_alipay_2",
          trade_no: "pay_alipay_2",
          trade_status: "TRADE_SUCCESS",
        }),
      })
    );
    const wechatContract = await parseWechatRecurringContractNotification(
      new Request("http://localhost/api/webhooks/wechat-pay/subscription-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: "provider_contract_wechat_2",
          out_contract_code: "contract_wechat_2",
          contract_state: "SIGNED",
          openid: "openid_wechat_2",
        }),
      })
    );
    const wechatBilling = await parseWechatRecurringBillingNotification(
      new Request("http://localhost/api/webhooks/wechat-pay/subscription-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          out_trade_no: "trade_wechat_2",
          transaction_id: "pay_wechat_2",
          trade_state: "SUCCESS",
        }),
      })
    );

    expect(alipayContract.contractId).toBe("contract_alipay_2");
    expect(alipayBilling.status).toBe("paid");
    expect(wechatContract.providerContractId).toBe("provider_contract_wechat_2");
    expect(wechatBilling.eventType).toBe("wechat.subscription.billing.paid");
  });
});
