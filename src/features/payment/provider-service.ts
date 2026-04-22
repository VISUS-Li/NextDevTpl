import crypto from "node:crypto";

import type { PaymentIntent, SalesOrderProvider } from "@/db/schema";
import { creem } from "@/features/payment/creem";
import {
  type PaymentCreateResult,
  PaymentDisplayMode,
  PaymentProvider,
} from "@/features/payment/types";

type CreatePaymentProviderParams = {
  intent: PaymentIntent;
  baseUrl: string;
  userAgent?: string | null | undefined;
  userIp?: string | null | undefined;
};

/**
 * 创建渠道支付时的统一入口。
 */
export async function createProviderCheckout(
  params: CreatePaymentProviderParams
): Promise<PaymentCreateResult> {
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return createMockCheckout(params.intent);
  }

  switch (params.intent.provider) {
    case PaymentProvider.CREEM:
      return await createCreemCheckout(params);
    case PaymentProvider.ALIPAY:
      return createAlipayCheckout(params);
    case PaymentProvider.WECHAT_PAY:
      return await createWechatCheckout(params);
    default:
      throw new Error(`不支持的支付渠道: ${params.intent.provider}`);
  }
}

/**
 * 使用模拟结果覆盖真实第三方调用，便于接口测试。
 */
function createMockCheckout(intent: PaymentIntent): PaymentCreateResult {
  if (intent.provider === PaymentProvider.WECHAT_PAY) {
    return {
      provider: PaymentProvider.WECHAT_PAY,
      displayMode: PaymentDisplayMode.QRCODE,
      checkoutUrl: null,
      qrCodeUrl: `weixin://wxpay/mock/${intent.outTradeNo}`,
      providerOrderId: `mock_wx_order_${intent.outTradeNo}`,
      providerPaymentId: null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      rawResponse: {
        mock: true,
        channel: "wechat_pay",
      },
    };
  }

  return {
    provider: intent.provider as PaymentProvider,
    displayMode: PaymentDisplayMode.REDIRECT,
    checkoutUrl: `https://mock-pay.tripai.local/${intent.provider}/${intent.outTradeNo}`,
    qrCodeUrl: null,
    providerOrderId: `mock_order_${intent.outTradeNo}`,
    providerCheckoutId:
      intent.provider === PaymentProvider.CREEM
        ? `mock_checkout_${intent.outTradeNo}`
        : null,
    providerPaymentId: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    rawResponse: {
      mock: true,
      channel: intent.provider,
    },
  };
}

/**
 * Creem 继续走托管式 checkout。
 */
async function createCreemCheckout(
  params: CreatePaymentProviderParams
): Promise<PaymentCreateResult> {
  const checkout = await creem.createCheckout({
    product_id: `credits_${params.intent.packageId}`,
    success_url: `${params.baseUrl}/dashboard/credits/buy/checkout?intentId=${params.intent.id}&success=true`,
    request_id: params.intent.outTradeNo,
    metadata: {
      userId: params.intent.userId,
      type: "credit_purchase",
      credits: String(params.intent.credits),
      packageId: params.intent.packageId,
      checkoutType: "credit_purchase",
      productType: "credit_package",
      outTradeNo: params.intent.outTradeNo,
      paymentIntentId: params.intent.id,
      ...(asStringRecord(params.intent.metadata) ?? {}),
    },
  });

  return {
    provider: PaymentProvider.CREEM,
    displayMode: PaymentDisplayMode.REDIRECT,
    checkoutUrl: checkout.checkout_url,
    qrCodeUrl: null,
    providerCheckoutId: checkout.id,
    providerOrderId: checkout.id,
    providerPaymentId: checkout.id,
    rawResponse: checkout as unknown as Record<string, unknown>,
  };
}

/**
 * 支付宝网页支付按当前终端生成跳转链接。
 */
function createAlipayCheckout(
  params: CreatePaymentProviderParams
): PaymentCreateResult {
  const isMobile = isMobileUserAgent(params.userAgent);
  const gateway = (
    process.env.ALIPAY_GATEWAY_URL?.trim() ||
    "https://openapi.alipay.com/gateway.do"
  ).replace(/\/+$/, "");
  const method = isMobile ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
  const productCode = isMobile ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY";
  const privateKey = requiredEnv("ALIPAY_PRIVATE_KEY");
  const appId = requiredEnv("ALIPAY_APP_ID");
  const notifyUrl =
    process.env.ALIPAY_NOTIFY_URL?.trim() ||
    `${params.baseUrl}/api/webhooks/alipay`;
  const returnUrl =
    process.env.ALIPAY_RETURN_URL?.trim() ||
    `${params.baseUrl}/dashboard/credits/buy/checkout?intentId=${params.intent.id}&success=true`;
  const bizContent = JSON.stringify({
    out_trade_no: params.intent.outTradeNo,
    total_amount: formatCurrencyAmount(
      params.intent.amount,
      params.intent.currency
    ),
    subject: params.intent.subject,
    product_code: productCode,
    passback_params: encodeURIComponent(params.intent.id),
  });
  const requestParams = {
    app_id: appId,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    notify_url: notifyUrl,
    return_url: returnUrl,
    biz_content: bizContent,
  };
  const sign = signAlipayRequest(requestParams, privateKey);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(requestParams)) {
    query.set(key, value);
  }
  query.set("sign", sign);

  return {
    provider: PaymentProvider.ALIPAY,
    displayMode: PaymentDisplayMode.REDIRECT,
    checkoutUrl: `${gateway}?${query.toString()}`,
    qrCodeUrl: null,
    providerOrderId: params.intent.outTradeNo,
    rawResponse: {
      method,
      gateway,
    },
  };
}

/**
 * 微信支付按终端区分 native 和 h5。
 */
async function createWechatCheckout(
  params: CreatePaymentProviderParams
): Promise<PaymentCreateResult> {
  const appId = requiredEnv("WECHAT_PAY_APP_ID");
  const mchId = requiredEnv("WECHAT_PAY_MCH_ID");
  const notifyUrl =
    process.env.WECHAT_PAY_NOTIFY_URL?.trim() ||
    `${params.baseUrl}/api/webhooks/wechat-pay`;
  const isMobile = isMobileUserAgent(params.userAgent);
  const path = isMobile
    ? "/v3/pay/transactions/h5"
    : "/v3/pay/transactions/native";
  const payload: Record<string, unknown> = {
    appid: appId,
    mchid: mchId,
    description: params.intent.subject,
    out_trade_no: params.intent.outTradeNo,
    notify_url: notifyUrl,
    amount: {
      total: params.intent.amount,
      currency: params.intent.currency,
    },
  };

  if (isMobile) {
    payload.scene_info = {
      payer_client_ip: params.userIp || "127.0.0.1",
      h5_info: {
        type: "Wap",
      },
    };
  }

  const response = await callWechatPay({
    method: "POST",
    path,
    body: JSON.stringify(payload),
  });

  return {
    provider: PaymentProvider.WECHAT_PAY,
    displayMode: isMobile
      ? PaymentDisplayMode.REDIRECT
      : PaymentDisplayMode.QRCODE,
    checkoutUrl: typeof response.h5_url === "string" ? response.h5_url : null,
    qrCodeUrl: typeof response.code_url === "string" ? response.code_url : null,
    providerOrderId: params.intent.outTradeNo,
    providerPaymentId: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    rawResponse: response,
  };
}

/**
 * 微信支付统一请求入口。
 */
async function callWechatPay(params: {
  method: "POST" | "GET";
  path: string;
  body?: string;
}) {
  const baseUrl = (
    process.env.WECHAT_PAY_API_BASE?.trim() || "https://api.mch.weixin.qq.com"
  ).replace(/\/+$/, "");
  const serialNo = requiredEnv("WECHAT_PAY_SERIAL_NO");
  const mchId = requiredEnv("WECHAT_PAY_MCH_ID");
  const privateKey = normalizePrivateKey(requiredEnv("WECHAT_PAY_PRIVATE_KEY"));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const body = params.body ?? "";
  const message = `${params.method}\n${params.path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(message)
    .sign(privateKey, "base64");
  const authorization =
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",` +
    `nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;

  const response = await fetch(`${baseUrl}${params.path}`, {
    method: params.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    ...(body ? { body } : {}),
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new Error(
      `微信支付下单失败: ${response.status} ${parsed.message ?? text}`
    );
  }
  return parsed;
}

/**
 * 支付宝签名串按字典序拼接。
 */
function signAlipayRequest(params: Record<string, string>, privateKey: string) {
  const content = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createSign("RSA-SHA256")
    .update(content, "utf8")
    .sign(normalizePrivateKey(privateKey), "base64");
}

/**
 * 将金额换成支付宝需要的小数字符串。
 */
function formatCurrencyAmount(amount: number, currency: string) {
  if (currency.toUpperCase() === "CNY") {
    return (amount / 100).toFixed(2);
  }
  return (amount / 100).toFixed(2);
}

/**
 * 支付宝时间格式必须是秒级本地时间。
 */
function formatAlipayTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 将多行私钥环境变量恢复成 PEM 格式。
 */
function normalizePrivateKey(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

/**
 * 判断当前请求是否更像移动端支付场景。
 */
function isMobileUserAgent(userAgent?: string | null) {
  if (!userAgent) {
    return false;
  }
  return /iphone|android|mobile|ipad/i.test(userAgent);
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少支付配置: ${name}`);
  }
  return value;
}

function asStringRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string") {
      result[key] = field;
    }
  }
  return result;
}

/**
 * 统一返回支付渠道名称，便于文案和日志复用。
 */
export function getPaymentProviderLabel(provider: SalesOrderProvider) {
  switch (provider) {
    case PaymentProvider.CREEM:
      return "Creem";
    case PaymentProvider.WECHAT_PAY:
      return "微信支付";
    case PaymentProvider.ALIPAY:
      return "支付宝";
    default:
      return provider;
  }
}
