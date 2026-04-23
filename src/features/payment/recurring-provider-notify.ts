import crypto from "node:crypto";

export type ParsedRecurringContractNotification = {
  contractId: string;
  providerContractId: string;
  providerExternalUserId: string | null;
  status: "active" | "terminated";
  signedAt: Date | null;
  nextBillingAt: Date | null;
  rawResponse: Record<string, unknown>;
};

export type ParsedRecurringBillingNotification = {
  outTradeNo: string;
  providerPaymentId: string | null;
  paidAt: Date | null;
  status: "paid" | "failed";
  failureReason: string | null;
  eventType: string;
  eventIdempotencyKey: string;
  rawResponse: Record<string, unknown>;
};

/**
 * 解析微信连续扣费签约或解约通知。
 */
export async function parseWechatRecurringContractNotification(request: Request) {
  const payload = await parseWechatRecurringNotification(request);
  const contractState =
    readString(payload, "contract_state") || readString(payload, "contract_status");
  const contractId =
    readString(payload, "out_contract_code") || readString(payload, "contract_id");
  if (!contractId || !contractState) {
    throw new Error("微信签约通知缺少协议信息");
  }

  return {
    contractId,
    providerContractId:
      readString(payload, "provider_contract_id") ||
      readString(payload, "contract_id") ||
      contractId,
    providerExternalUserId:
      readString(payload, "out_user_code") ||
      readString(payload, "external_user_id") ||
      readString(payload, "openid"),
    status:
      contractState === "TERMINATED" ? "terminated" : "active",
    signedAt: readDate(payload, "contract_signed_time"),
    nextBillingAt: readWechatNextBillingAt(payload),
    rawResponse: payload,
  } satisfies ParsedRecurringContractNotification;
}

/**
 * 解析微信连续扣费账单通知。
 */
export async function parseWechatRecurringBillingNotification(request: Request) {
  const payload = await parseWechatRecurringNotification(request);
  const outTradeNo = readString(payload, "out_trade_no");
  if (!outTradeNo) {
    throw new Error("微信账单通知缺少商户订单号");
  }

  const tradeState = readString(payload, "trade_state") ?? "SUCCESS";
  const transactionId = readString(payload, "transaction_id");
  return {
    outTradeNo,
    providerPaymentId: transactionId,
    paidAt: readDate(payload, "success_time"),
    status: tradeState === "SUCCESS" ? "paid" : "failed",
    failureReason: tradeState === "SUCCESS" ? null : tradeState,
    eventType:
      tradeState === "SUCCESS"
        ? "wechat.subscription.billing.paid"
        : "wechat.subscription.billing.failed",
    eventIdempotencyKey: `wechat_pay:subscription.billing:${transactionId ?? outTradeNo}:${tradeState}`,
    rawResponse: payload,
  } satisfies ParsedRecurringBillingNotification;
}

/**
 * 解析支付宝连续扣费签约回调。
 */
export async function parseAlipayRecurringContractNotification(request: Request) {
  const payload = await parseAlipayRecurringNotification(request);
  const contractId = payload.out_agreement_no;
  const status = payload.status ?? "";
  if (!contractId || !status) {
    throw new Error("支付宝签约通知缺少协议信息");
  }

  return {
    contractId,
    providerContractId: payload.agreement_no ?? contractId,
    providerExternalUserId:
      payload.external_logon_id ?? payload.alipay_user_id ?? null,
    status: status === "ACTIVE" ? "active" : "terminated",
    signedAt: payload.sign_time ? new Date(payload.sign_time) : null,
    nextBillingAt: readAlipayNextBillingAt(payload),
    rawResponse: payload,
  } satisfies ParsedRecurringContractNotification;
}

/**
 * 解析支付宝连续扣费账单回调。
 */
export async function parseAlipayRecurringBillingNotification(request: Request) {
  const payload = await parseAlipayRecurringNotification(request);
  const outTradeNo = payload.out_trade_no;
  if (!outTradeNo) {
    throw new Error("支付宝账单通知缺少商户订单号");
  }

  const tradeStatus = payload.trade_status ?? "";
  return {
    outTradeNo,
    providerPaymentId: payload.trade_no ?? null,
    paidAt: payload.gmt_payment ? new Date(payload.gmt_payment) : null,
    status:
      tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED"
        ? "paid"
        : "failed",
    failureReason:
      tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED"
        ? null
        : tradeStatus || null,
    eventType:
      tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED"
        ? "alipay.subscription.billing.paid"
        : "alipay.subscription.billing.failed",
    eventIdempotencyKey: `alipay:subscription.billing:${payload.trade_no ?? outTradeNo}:${tradeStatus || "unknown"}`,
    rawResponse: payload,
  } satisfies ParsedRecurringBillingNotification;
}

/**
 * 微信连续扣费通知解析。
 */
async function parseWechatRecurringNotification(request: Request) {
  const body = await request.text();
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return JSON.parse(body) as Record<string, unknown>;
  }

  verifyWechatNotificationSignature(body, request.headers);
  const envelope = JSON.parse(body) as {
    id?: string;
    event_type?: string;
    resource?: {
      ciphertext: string;
      nonce: string;
      associated_data?: string;
    };
  };
  if (!envelope.resource) {
    throw new Error("微信连续扣费通知缺少 resource");
  }

  const decrypted = decryptWechatCipherText(envelope.resource);
  return {
    ...(decrypted as Record<string, unknown>),
    notify_id: envelope.id ?? null,
    event_type: envelope.event_type ?? null,
  };
}

/**
 * 支付宝连续扣费通知解析。
 */
async function parseAlipayRecurringNotification(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await request.json()) as Record<string, string>)
    : (Object.fromEntries((await request.formData()).entries()) as Record<
        string,
        string
      >);

  if (process.env.PAYMENT_MOCK_MODE !== "true") {
    verifyAlipayNotificationSignature(payload);
  }

  return payload;
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

function readWechatNextBillingAt(payload: Record<string, unknown>) {
  const deductSchedule =
    payload.deduct_schedule as Record<string, unknown> | undefined;
  const value =
    readString(deductSchedule, "deduct_date") ||
    readString(deductSchedule, "estimated_deduct_date");
  return value ? new Date(`${value}T00:00:00+08:00`) : null;
}

function readAlipayNextBillingAt(payload: Record<string, string>) {
  const value = payload.deduct_time || payload.next_deduct_time || "";
  return value ? new Date(value) : null;
}

function readDate(payload: Record<string, unknown>, key: string) {
  const value = readString(payload, key);
  return value ? new Date(value) : null;
}

function readString(payload: Record<string, unknown> | undefined, key: string) {
  if (!payload) {
    return null;
  }
  const value = payload[key];
  return typeof value === "string" && value ? value : null;
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
