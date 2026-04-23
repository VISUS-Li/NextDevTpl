import crypto from "node:crypto";

import type { SubscriptionContract } from "@/db/schema";

type RecurringProviderContract = Pick<
  SubscriptionContract,
  | "id"
  | "provider"
  | "planId"
  | "billingInterval"
  | "providerContractId"
  | "providerPlanId"
  | "metadata"
>;

export type RecurringProviderContractQueryResult = {
  providerContractId: string | null;
  status: "pending_sign" | "active" | "terminated" | "paused" | "failed";
  nextBillingAt: Date | null;
  rawResponse: Record<string, unknown> | null;
};

/**
 * 创建渠道侧签约链接。
 */
export async function createRecurringProviderSigningUrl(params: {
  contract: RecurringProviderContract;
  baseUrl: string;
}) {
  if (params.contract.provider === "wechat_pay") {
    return createWechatContractSigningUrl(params.contract, params.baseUrl);
  }

  return createAlipayContractSigningUrl(params.contract, params.baseUrl);
}

/**
 * 查询渠道侧签约状态。
 */
export async function queryRecurringProviderContract(
  contract: RecurringProviderContract
): Promise<RecurringProviderContractQueryResult> {
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return {
      providerContractId: contract.providerContractId ?? `mock_${contract.id}`,
      status: contract.providerContractId ? "active" : "pending_sign",
      nextBillingAt: null,
      rawResponse: {
        mock: true,
        provider: contract.provider,
      },
    };
  }

  if (contract.provider === "alipay") {
    return queryAlipayRecurringContract(contract);
  }

  return queryWechatRecurringContract(contract);
}

/**
 * 渠道侧主动解约。
 */
export async function cancelRecurringProviderContract(
  contract: RecurringProviderContract
) {
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return;
  }
  if (!contract.providerContractId) {
    throw new Error("缺少渠道协议号，无法解约");
  }

  if (contract.provider === "alipay") {
    await cancelAlipayRecurringContract(contract);
    return;
  }

  await cancelWechatRecurringContract(contract);
}

/**
 * 微信签约链接创建。
 */
function createWechatContractSigningUrl(
  contract: RecurringProviderContract,
  baseUrl: string
) {
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return `${baseUrl}/dashboard/credits/buy/checkout?wechatContract=${contract.id}`;
  }

  const custom = process.env.WECHAT_PAY_PAPAY_SIGN_URL?.trim();
  if (custom) {
    const url = new URL(custom);
    url.searchParams.set("contractId", contract.id);
    url.searchParams.set("planId", contract.planId);
    url.searchParams.set("interval", contract.billingInterval);
    return url.toString();
  }

  throw new Error("缺少微信连续扣费签约地址配置: WECHAT_PAY_PAPAY_SIGN_URL");
}

/**
 * 支付宝签约链接创建。
 */
function createAlipayContractSigningUrl(
  contract: RecurringProviderContract,
  baseUrl: string
) {
  if (process.env.PAYMENT_MOCK_MODE === "true") {
    return `${baseUrl}/dashboard/credits/buy/checkout?alipayContract=${contract.id}`;
  }

  const gateway = getAlipayGatewayUrl();
  const requestParams = {
    app_id: requiredEnv("ALIPAY_APP_ID"),
    method: "alipay.user.agreement.page.sign",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    notify_url:
      process.env.ALIPAY_AGREEMENT_NOTIFY_URL?.trim() ||
      `${baseUrl}/api/webhooks/alipay/subscription-contract`,
    return_url:
      process.env.ALIPAY_RETURN_URL?.trim() ||
      `${baseUrl}/dashboard/credits/buy/checkout?contractId=${contract.id}`,
    biz_content: JSON.stringify({
      out_agreement_no: contract.id,
      sign_scene: "INDUSTRY|CATALOG|SMALLAPP",
      personal_product_code: "CYCLE_PAY_AUTH_P",
      access_params: {
        channel: "WEB",
      },
    }),
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(requestParams)) {
    query.set(key, value);
  }
  query.set(
    "sign",
    signAlipayRequest(
      requestParams,
      normalizePem(requiredEnv("ALIPAY_PRIVATE_KEY"))
    )
  );
  return `${gateway}?${query.toString()}`;
}

/**
 * 微信查约。
 */
async function queryWechatRecurringContract(
  contract: RecurringProviderContract
): Promise<RecurringProviderContractQueryResult> {
  const planId = resolveWechatPlanId(contract);
  const response = await callWechatPayV3({
    method: "GET",
    path: `/v3/papay/sign/contracts/plan-id/${encodeURIComponent(
      planId
    )}/out-contract-code/${encodeURIComponent(contract.id)}`,
  });

  return {
    providerContractId:
      readString(response, "contract_id") ?? contract.providerContractId ?? null,
    status: mapWechatContractStatus(readString(response, "contract_state")),
    nextBillingAt: readWechatEstimatedDate(response),
    rawResponse: response,
  };
}

/**
 * 微信解约。
 */
async function cancelWechatRecurringContract(contract: RecurringProviderContract) {
  const planId = resolveWechatPlanId(contract);
  await callWechatPayV3({
    method: "POST",
    path: `/v3/papay/sign/contracts/plan-id/${encodeURIComponent(
      planId
    )}/out-contract-code/${encodeURIComponent(contract.id)}/terminate`,
    body: JSON.stringify({
      appid: requiredEnv("WECHAT_PAY_APP_ID"),
      contract_termination_remark: "tripai user cancel",
    }),
  });
}

/**
 * 支付宝查约。
 */
async function queryAlipayRecurringContract(
  contract: RecurringProviderContract
): Promise<RecurringProviderContractQueryResult> {
  const payload = await callAlipayApi("alipay.user.agreement.query", {
    personal_product_code: "CYCLE_PAY_AUTH_P",
    external_agreement_no: contract.id,
    agreement_no: contract.providerContractId ?? undefined,
  });
  const result = payload.alipay_user_agreement_query_response as
    | Record<string, string>
    | undefined;

  if (!result || result.code !== "10000") {
    throw new Error(
      `支付宝查约失败: ${result?.sub_msg ?? result?.msg ?? "empty response"}`
    );
  }

  return {
    providerContractId: result.agreement_no ?? contract.providerContractId ?? null,
    status: mapAlipayContractStatus(result.status),
    nextBillingAt: readAlipayNextBillingAt(result),
    rawResponse: payload,
  };
}

/**
 * 支付宝解约。
 */
async function cancelAlipayRecurringContract(contract: RecurringProviderContract) {
  const payload = await callAlipayApi("alipay.user.agreement.unsign", {
    personal_product_code: "CYCLE_PAY_AUTH_P",
    agreement_no: contract.providerContractId,
    remark: "tripai user cancel",
  });
  const result = payload.alipay_user_agreement_unsign_response as
    | Record<string, string>
    | undefined;

  if (!result || result.code !== "10000") {
    throw new Error(
      `支付宝代扣解约失败: ${result?.sub_msg ?? result?.msg ?? "empty response"}`
    );
  }
}

/**
 * 调支付宝开放平台接口。
 */
async function callAlipayApi(
  method: string,
  bizContent: Record<string, unknown>
) {
  const requestParams = {
    app_id: requiredEnv("ALIPAY_APP_ID"),
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    biz_content: JSON.stringify(
      Object.fromEntries(
        Object.entries(bizContent).filter(([, value]) => value !== undefined)
      )
    ),
  };
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(requestParams)) {
    form.set(key, value);
  }
  form.set(
    "sign",
    signAlipayRequest(
      requestParams,
      normalizePem(requiredEnv("ALIPAY_PRIVATE_KEY"))
    )
  );

  const response = await fetch(getAlipayGatewayUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: form.toString(),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new Error(`支付宝接口请求失败: ${response.status} ${response.statusText}`);
  }

  return payload;
}

/**
 * 微信支付 v3 连续扣费接口调用。
 */
async function callWechatPayV3(params: {
  method: "GET" | "POST" | "DELETE";
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
    .update(message, "utf8")
    .sign(privateKey, "base64");
  const authorization =
      `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",` +
    `nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;

  const response = await fetch(`${baseUrl}${params.path}`, {
    method: params.method,
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      ...(params.method === "GET"
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body ? { body } : {}),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new Error(
      `微信连续扣费接口失败: ${response.status} ${readString(payload, "message") ?? text}`
    );
  }

  return payload;
}

function resolveWechatPlanId(contract: RecurringProviderContract) {
  const planId =
    contract.providerPlanId ||
    readString(contract.metadata ?? undefined, "providerPlanId") ||
    process.env.WECHAT_PAY_PAPAY_PLAN_ID?.trim() ||
    "";
  if (!planId) {
    throw new Error("缺少微信连续扣费模板 ID 配置: WECHAT_PAY_PAPAY_PLAN_ID");
  }
  return planId;
}

function mapWechatContractStatus(status: string | null) {
  switch (status) {
    case "SIGNED":
      return "active";
    case "TERMINATED":
      return "terminated";
    default:
      return "pending_sign";
  }
}

function mapAlipayContractStatus(status: string | undefined) {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "STOP":
    case "UNSIGN":
      return "terminated";
    case "PAUSE":
      return "paused";
    default:
      return "pending_sign";
  }
}

function readWechatEstimatedDate(payload: Record<string, unknown>) {
  const deductSchedule =
    payload.deduct_schedule as Record<string, unknown> | undefined;
  const dateValue =
    readString(deductSchedule, "deduct_date") ||
    readString(deductSchedule, "estimated_deduct_date");
  return dateValue ? new Date(`${dateValue}T00:00:00+08:00`) : null;
}

function readAlipayNextBillingAt(payload: Record<string, string>) {
  const value =
    payload.deduct_time ||
    payload.next_deduct_time ||
    payload.valid_time ||
    "";
  return value ? new Date(value) : null;
}

function getAlipayGatewayUrl() {
  return (
    process.env.ALIPAY_GATEWAY_URL?.trim() ||
    "https://openapi.alipay.com/gateway.do"
  ).replace(/\/+$/, "");
}

function signAlipayRequest(params: Record<string, string>, privateKey: string) {
  const content = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createSign("RSA-SHA256")
    .update(content, "utf8")
    .sign(privateKey, "base64");
}

function formatAlipayTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function normalizePem(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少支付配置: ${name}`);
  }
  return value;
}

function readString(
  source: Record<string, unknown> | undefined,
  key?: string
): string | null {
  if (!source) {
    return null;
  }
  if (!key) {
    return null;
  }
  const value = source[key];
  return typeof value === "string" && value ? value : null;
}
