import crypto from "node:crypto";

type ParsedWechatPayment = {
  outTradeNo: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  paidAt: Date;
  eventType: string;
  eventIdempotencyKey: string;
  rawResponse: Record<string, unknown>;
};

type ParsedAlipayPayment = ParsedWechatPayment;

/**
 * 解析微信支付成功通知。
 */
export async function parseWechatPaymentNotification(request: Request) {
  const body = await request.text();
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    const payload = JSON.parse(body) as Record<string, unknown>;
    return buildWechatResult(payload);
  }

  verifyWechatNotificationSignature(body, request.headers);
  const envelope = JSON.parse(body) as {
    id?: string;
    resource?: {
      ciphertext: string;
      nonce: string;
      associated_data?: string;
    };
  };
  if (!envelope.resource) {
    throw new Error("微信回调缺少 resource");
  }

  const decrypted = decryptWechatCipherText(envelope.resource);
  return buildWechatResult({
    ...(decrypted as Record<string, unknown>),
    notify_id: envelope.id ?? null,
  });
}

/**
 * 解析支付宝支付成功通知。
 */
export async function parseAlipayPaymentNotification(request: Request) {
  const form = await request.formData();
  const payload = Object.fromEntries(form.entries()) as Record<string, string>;
  if (process.env.PAYMENT_MOCK_MODE !== "true") {
    verifyAlipayNotificationSignature(payload);
  }

  const tradeStatus = payload.trade_status ?? "";
  if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
    throw new Error(`支付宝交易状态未成功: ${tradeStatus}`);
  }

  const providerPaymentId = payload.trade_no || null;
  const outTradeNo = payload.out_trade_no;
  if (!outTradeNo) {
    throw new Error("支付宝回调缺少 out_trade_no");
  }

  return {
    outTradeNo,
    providerOrderId: outTradeNo,
    providerPaymentId,
    paidAt: payload.gmt_payment ? new Date(payload.gmt_payment) : new Date(),
    eventType: "alipay.trade.success",
    eventIdempotencyKey: `alipay:payment.paid:${providerPaymentId ?? outTradeNo}`,
    rawResponse: payload,
  } satisfies ParsedAlipayPayment;
}

/**
 * 微信支付通知成功回执。
 */
export function buildWechatNotifySuccessResponse() {
  return {
    code: "SUCCESS",
    message: "成功",
  };
}

function buildWechatResult(payload: Record<string, unknown>) {
  const outTradeNo =
    typeof payload.out_trade_no === "string" ? payload.out_trade_no : "";
  const providerPaymentId =
    typeof payload.transaction_id === "string" ? payload.transaction_id : null;
  const tradeState =
    typeof payload.trade_state === "string" ? payload.trade_state : "SUCCESS";
  if (tradeState !== "SUCCESS") {
    throw new Error(`微信交易状态未成功: ${tradeState}`);
  }
  if (!outTradeNo) {
    throw new Error("微信回调缺少 out_trade_no");
  }

  return {
    outTradeNo,
    providerOrderId: outTradeNo,
    providerPaymentId,
    paidAt:
      typeof payload.success_time === "string"
        ? new Date(payload.success_time)
        : new Date(),
    eventType: "wechat.pay.success",
    eventIdempotencyKey: `wechat_pay:payment.paid:${providerPaymentId ?? outTradeNo}`,
    rawResponse: payload,
  } satisfies ParsedWechatPayment;
}

/**
 * 微信平台公钥验签。
 */
function verifyWechatNotificationSignature(body: string, headers: Headers) {
  const timestamp = headers.get("wechatpay-timestamp")?.trim() || "";
  const nonce = headers.get("wechatpay-nonce")?.trim() || "";
  const signature = headers.get("wechatpay-signature")?.trim() || "";
  const publicKey = normalizePublicKey(requiredEnv("WECHAT_PAY_PUBLIC_KEY"));

  if (!timestamp || !nonce || !signature) {
    throw new Error("微信回调签名头缺失");
  }

  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const verified = crypto
    .createVerify("RSA-SHA256")
    .update(message, "utf8")
    .verify(publicKey, signature, "base64");

  if (!verified) {
    throw new Error("微信回调验签失败");
  }
}

/**
 * 解密微信 v3 回调密文。
 */
function decryptWechatCipherText(resource: {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}) {
  const apiV3Key = Buffer.from(requiredEnv("WECHAT_PAY_API_V3_KEY"), "utf8");
  const encrypted = Buffer.from(resource.ciphertext, "base64");
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    apiV3Key,
    Buffer.from(resource.nonce, "utf8")
  );
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}

/**
 * 支付宝公钥验签。
 */
function verifyAlipayNotificationSignature(payload: Record<string, string>) {
  const sign = payload.sign;
  if (!sign) {
    throw new Error("支付宝回调缺少 sign");
  }
  const verifyContent = Object.entries(payload)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const publicKey = normalizePublicKey(requiredEnv("ALIPAY_PUBLIC_KEY"));
  const verified = crypto
    .createVerify("RSA-SHA256")
    .update(verifyContent, "utf8")
    .verify(publicKey, sign, "base64");

  if (!verified) {
    throw new Error("支付宝回调验签失败");
  }
}

function normalizePublicKey(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少支付配置: ${name}`);
  }
  return value;
}
