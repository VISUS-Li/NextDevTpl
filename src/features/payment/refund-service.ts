import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  paymentIntent,
  salesOrder,
  salesOrderItem,
  subscription,
  subscriptionBilling,
  subscriptionContract,
} from "@/db/schema";
import {
  consumeCredits,
  getCreditsBalance,
  InsufficientCreditsError,
} from "@/features/credits/core";
import { applySalesAfterSalesEvent } from "@/features/distribution/orders";
import { updatePaymentIntentStatus } from "@/features/payment/payment-intents";

type RefundPaymentParams = {
  orderId: string;
  amount: number;
  reason: string;
  operatorUserId: string;
};

/**
 * 管理端退款结果。
 */
export type RefundPaymentResult = {
  orderId: string;
  orderItemId: string;
  eventId: string;
  providerRefundId: string | null;
  refundAmount: number;
  currency: string;
  paymentIntentId: string | null;
  refundedCredits: number;
};

/**
 * 管理端统一退款入口。
 */
export async function refundAdminPayment(
  params: RefundPaymentParams
): Promise<RefundPaymentResult> {
  const [order] = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.id, params.orderId))
    .limit(1);

  if (!order) {
    throw new Error("支付订单不存在");
  }

  if (order.orderType === "credit_purchase") {
    return refundCreditPurchasePayment(params);
  }

  return refundSubscriptionPayment(params);
}

/**
 * 发起一次性支付退款。
 *
 * 当前阶段只开放积分包退款，且退款前会先回收对应积分。
 */
export async function refundCreditPurchasePayment(
  params: RefundPaymentParams
): Promise<RefundPaymentResult> {
  const [order] = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.id, params.orderId))
    .limit(1);

  if (!order) {
    throw new Error("支付订单不存在");
  }
  if (order.orderType !== "credit_purchase") {
    throw new Error("当前阶段只支持积分包退款");
  }

  const [item] = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.orderId, params.orderId))
    .limit(1);
  if (!item) {
    throw new Error("支付订单项不存在");
  }
  if (params.amount <= 0) {
    throw new Error("退款金额必须大于 0");
  }
  if (params.amount > item.refundableAmount) {
    throw new Error("退款金额超过可退范围");
  }

  const [currentIntent] = await db
    .select()
    .from(paymentIntent)
    .where(
      and(
        eq(
          paymentIntent.id,
          readStringMetadata(order.metadata, "paymentIntentId") ?? ""
        ),
        eq(paymentIntent.userId, order.userId)
      )
    )
    .limit(1);

  const refundedCredits = calculateRefundedCredits({
    grossAmount: item.grossAmount,
    refundAmount: params.amount,
    credits: Number(item.metadata?.credits ?? order.metadata?.credits ?? 0),
  });

  if (refundedCredits > 0) {
    const balance = await getCreditsBalance(order.userId);
    if (balance.balance < refundedCredits) {
      throw new InsufficientCreditsError(refundedCredits, balance.balance);
    }

    await consumeCredits({
      userId: order.userId,
      amount: refundedCredits,
      serviceName: "payment_refund_reclaim",
      description: `退款回收积分 ${refundedCredits}`,
      metadata: {
        orderId: order.id,
        orderItemId: item.id,
        operatorUserId: params.operatorUserId,
      },
    });
  }

  const refundResponse = await requestProviderRefund({
    provider: order.provider,
    amount: params.amount,
    totalAmount: item.grossAmount,
    currency: order.currency,
    orderId: order.id,
    providerOrderId: order.providerOrderId,
    providerPaymentId: order.providerPaymentId,
    reason: params.reason,
  });

  const fullyRefunded = params.amount === item.refundableAmount;
  const eventType = fullyRefunded ? "refunded" : "partial_refund";
  const eventId = await applySalesAfterSalesEvent({
    orderId: order.id,
    orderItemId: item.id,
    amount: params.amount,
    currency: order.currency,
    eventType,
    eventIdempotencyKey: `${order.provider}:manual_refund:${order.id}:${params.amount}:${params.reason}`,
    providerEventId: refundResponse.providerRefundId,
    reason: params.reason,
    metadata: {
      operatorUserId: params.operatorUserId,
      providerRefundId: refundResponse.providerRefundId,
      refundedCredits,
      response: refundResponse.rawResponse,
    },
  });

  if (fullyRefunded && currentIntent) {
    await updatePaymentIntentStatus(currentIntent.id, "refunded");
  }

  return {
    orderId: order.id,
    orderItemId: item.id,
    eventId,
    providerRefundId: refundResponse.providerRefundId,
    refundAmount: params.amount,
    currency: order.currency,
    paymentIntentId: currentIntent?.id ?? null,
    refundedCredits,
  };
}

/**
 * 退款订阅账单。
 *
 * 当前阶段只支持整单退款，退款后会暂停协议并标记当前账单已退款。
 */
export async function refundSubscriptionPayment(
  params: RefundPaymentParams
): Promise<RefundPaymentResult> {
  const [order] = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.id, params.orderId))
    .limit(1);

  if (!order) {
    throw new Error("支付订单不存在");
  }
  if (order.orderType !== "subscription") {
    throw new Error("当前订单不是订阅订单");
  }

  const [item] = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.orderId, params.orderId))
    .limit(1);
  if (!item) {
    throw new Error("支付订单项不存在");
  }
  if (params.amount !== item.refundableAmount) {
    throw new Error("当前阶段订阅只支持全额退款");
  }

  const refundedCredits = calculateRefundedCredits({
    grossAmount: item.grossAmount,
    refundAmount: params.amount,
    credits: Number(item.metadata?.credits ?? 0),
  });

  if (refundedCredits > 0) {
    const balance = await getCreditsBalance(order.userId);
    if (balance.balance < refundedCredits) {
      throw new InsufficientCreditsError(refundedCredits, balance.balance);
    }

    await consumeCredits({
      userId: order.userId,
      amount: refundedCredits,
      serviceName: "subscription_refund_reclaim",
      description: `订阅退款回收积分 ${refundedCredits}`,
      metadata: {
        orderId: order.id,
        orderItemId: item.id,
        operatorUserId: params.operatorUserId,
      },
    });
  }

  const refundResponse = await requestProviderRefund({
    provider: order.provider,
    amount: params.amount,
    totalAmount: item.grossAmount,
    currency: order.currency,
    orderId: order.id,
    providerOrderId: order.providerOrderId,
    providerPaymentId: order.providerPaymentId,
    reason: params.reason,
  });

  const eventId = await applySalesAfterSalesEvent({
    orderId: order.id,
    orderItemId: item.id,
    amount: params.amount,
    currency: order.currency,
    eventType: "refunded",
    eventIdempotencyKey: `${order.provider}:subscription_refund:${order.id}:${params.amount}`,
    providerEventId: refundResponse.providerRefundId,
    reason: params.reason,
    metadata: {
      operatorUserId: params.operatorUserId,
      providerRefundId: refundResponse.providerRefundId,
      refundedCredits,
      response: refundResponse.rawResponse,
    },
  });

  const billingId = readStringMetadata(item.metadata, "billingId") ??
    readStringMetadata(order.metadata, "billingId");
  const contractId = readStringMetadata(item.metadata, "contractId") ??
    readStringMetadata(order.metadata, "contractId");
  const providerSubscriptionId =
    order.providerSubscriptionId ?? readStringMetadata(order.metadata, "contractId");

  if (billingId) {
    await db
      .update(subscriptionBilling)
      .set({
        status: "refunded",
        updatedAt: new Date(),
        metadata: {
          refundedBy: params.operatorUserId,
          providerRefundId: refundResponse.providerRefundId,
        },
      })
      .where(eq(subscriptionBilling.id, billingId));
  }

  if (contractId) {
    await db
      .update(subscriptionContract)
      .set({
        status: "paused",
        updatedAt: new Date(),
      })
      .where(eq(subscriptionContract.id, contractId));
  }

  if (providerSubscriptionId) {
    await db
      .update(subscription)
      .set({
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(subscription.subscriptionId, providerSubscriptionId));
  }

  return {
    orderId: order.id,
    orderItemId: item.id,
    eventId,
    providerRefundId: refundResponse.providerRefundId,
    refundAmount: params.amount,
    currency: order.currency,
    paymentIntentId: null,
    refundedCredits,
  };
}

async function requestProviderRefund(params: {
  provider: (typeof salesOrder.$inferSelect)["provider"];
  amount: number;
  totalAmount: number;
  currency: string;
  orderId: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  reason: string;
}) {
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return {
      providerRefundId: `mock_refund_${params.orderId}_${params.amount}`,
      rawResponse: {
        mock: true,
        provider: params.provider,
      },
    };
  }

  switch (params.provider) {
    case "wechat_pay":
      return await requestWechatRefund(params);
    case "alipay":
      return requestAlipayRefund(params);
    default:
      throw new Error(`当前退款渠道暂未接入: ${params.provider}`);
  }
}

/**
 * 微信支付退款。
 */
async function requestWechatRefund(params: {
  amount: number;
  totalAmount: number;
  currency: string;
  orderId: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  reason: string;
}) {
  const outRefundNo = `refund_${params.orderId}_${Date.now()}`;
  const response = await callWechatPay({
    method: "POST",
    path: "/v3/refund/domestic/refunds",
    body: JSON.stringify({
      out_trade_no: params.providerOrderId,
      transaction_id: params.providerPaymentId,
      out_refund_no: outRefundNo,
      reason: params.reason,
      notify_url: process.env.WECHAT_PAY_REFUND_NOTIFY_URL?.trim(),
      amount: {
        refund: params.amount,
        total: params.totalAmount,
        currency: params.currency,
      },
    }),
  });

  return {
    providerRefundId:
      typeof response.refund_id === "string" ? response.refund_id : outRefundNo,
    rawResponse: response,
  };
}

/**
 * 支付宝退款。
 */
function requestAlipayRefund(params: {
  amount: number;
  currency: string;
  orderId: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  reason: string;
}) {
  const gateway = (
    process.env.ALIPAY_GATEWAY_URL?.trim() ||
    "https://openapi.alipay.com/gateway.do"
  ).replace(/\/+$/, "");
  const appId = requiredEnv("ALIPAY_APP_ID");
  const privateKey = normalizePem(requiredEnv("ALIPAY_PRIVATE_KEY"));
  const refundRequestNo = `refund_${params.orderId}_${Date.now()}`;
  const bizContent = JSON.stringify({
    out_trade_no: params.providerOrderId,
    trade_no: params.providerPaymentId,
    refund_amount: formatAmount(params.amount, params.currency),
    out_request_no: refundRequestNo,
    refund_reason: params.reason,
  });
  const requestParams = {
    app_id: appId,
    method: "alipay.trade.refund",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    biz_content: bizContent,
  };
  const sign = signAlipayRequest(requestParams, privateKey);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(requestParams)) {
    query.set(key, value);
  }
  query.set("sign", sign);

  return {
    providerRefundId: refundRequestNo,
    rawResponse: {
      gateway,
      url: `${gateway}?${query.toString()}`,
      requestNo: refundRequestNo,
    },
  };
}

function calculateRefundedCredits(params: {
  grossAmount: number;
  refundAmount: number;
  credits: number;
}) {
  if (params.grossAmount <= 0 || params.credits <= 0) {
    return 0;
  }
  return Math.round(
    (params.credits * params.refundAmount) / params.grossAmount
  );
}

function readStringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : null;
}

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
  const privateKey = normalizePem(requiredEnv("WECHAT_PAY_PRIVATE_KEY"));
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
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization,
    },
    ...(body ? { body } : {}),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`微信退款失败: ${JSON.stringify(payload)}`);
  }
  return payload as Record<string, unknown>;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少支付配置: ${name}`);
  }
  return value;
}

function normalizePem(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function signAlipayRequest(params: Record<string, string>, privateKey: string) {
  const content = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createSign("RSA-SHA256")
    .update(content, "utf8")
    .sign(privateKey, "base64");
}

function formatAlipayTimestamp(value: Date) {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
    value.getDate()
  )} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(
    value.getSeconds()
  )}`;
}

function formatAmount(amount: number, currency: string) {
  if (currency.toUpperCase() === "JPY") {
    return String(amount);
  }
  return (amount / 100).toFixed(2);
}
