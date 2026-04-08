import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  aiBillingRecord,
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  aiRequestAttempt,
  aiRequestLog,
  type AIBillingMode,
  type AIRelayModelBinding,
  type AIRouteStrategy,
} from "@/db/schema";
import {
  AccountFrozenError,
  consumeCredits,
  getCreditsBalance,
  InsufficientCreditsError,
} from "@/features/credits/core";
import { DEFAULT_PROJECT_KEY, getResolvedToolConfig, seedDefaultToolConfigProject } from "@/features/tool-config/service";
import { chatCompletionWithUsage, type AIChatResult } from "@/lib/ai";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

export class AIGatewayError extends Error {
  constructor(
    public code:
      | "feature_disabled"
      | "pricing_rule_missing"
      | "provider_unavailable"
      | "model_not_allowed"
      | "upstream_error"
      | "billing_failed",
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "AIGatewayError";
  }
}

type ChatFeatureConfig = {
  enabled?: boolean;
  billingMode?: AIBillingMode;
  defaultCredits?: number;
  minimumCredits?: number;
};

type ResolvedToolAISettings = {
  requestedModel: string;
  routeStrategy: AIRouteStrategy;
  preferredProviderKey: string | null;
  allowedModels: string[];
  allowedProviderKeys: string[];
  featureConfig: ChatFeatureConfig | null;
};

type CandidateBinding = {
  binding: AIRelayModelBinding;
  provider: typeof aiRelayProvider.$inferSelect;
};

export type ExecuteAIChatParams = {
  userId: string;
  toolKey: string;
  featureKey: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  stream?: boolean;
  model?: string;
  temperature?: number;
  metadata?: Record<string, unknown>;
};

export type ExecuteAIChatResult = {
  requestId: string;
  provider: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  billing: {
    chargedCredits: number;
    billingMode: AIBillingMode;
    remainingBalance: number;
  };
};

/**
 * 读取工具 AI 设置。
 */
async function resolveToolAISettings(
  userId: string,
  toolKey: string,
  featureKey: string,
  model?: string
): Promise<ResolvedToolAISettings> {
  await seedDefaultToolConfigProject({ projectKey: DEFAULT_PROJECT_KEY });
  const resolved = await getResolvedToolConfig({
    projectKey: DEFAULT_PROJECT_KEY,
    toolKey,
    userId,
  });
  const config = resolved.config as Record<string, unknown>;
  const featureConfigMap =
    typeof config.json2 === "object" && config.json2
      ? (config.json2 as Record<string, ChatFeatureConfig>)
      : {};
  const featureConfig = featureConfigMap[featureKey] ?? null;

  if (featureConfig?.enabled === false) {
    throw new AIGatewayError("feature_disabled", "当前功能未启用", 403);
  }

  const requestedModel =
    model || asString(config.config1) || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const routeStrategy = parseRouteStrategy(asString(config.config2));
  const preferredProviderKey = asString(config.config3);
  const allowedModels = asStringArray(config.json1);
  const allowedProviderKeys = asStringArray(config.json3);

  if (allowedModels.length > 0 && !allowedModels.includes(requestedModel)) {
    throw new AIGatewayError("model_not_allowed", "当前模型未开放给该工具", 403);
  }

  return {
    requestedModel,
    routeStrategy,
    preferredProviderKey,
    allowedModels,
    allowedProviderKeys,
    featureConfig,
  };
}

/**
 * 查询适用的计费规则。
 */
async function getPricingRule(toolKey: string, featureKey: string, modelKey: string) {
  const [exactRule] = await db
    .select()
    .from(aiPricingRule)
    .where(
      and(
        eq(aiPricingRule.toolKey, toolKey),
        eq(aiPricingRule.featureKey, featureKey),
        eq(aiPricingRule.requestType, "chat"),
        eq(aiPricingRule.modelScope, modelKey),
        eq(aiPricingRule.enabled, true)
      )
    )
    .limit(1);

  if (exactRule) {
    return exactRule;
  }

  const [defaultRule] = await db
    .select()
    .from(aiPricingRule)
    .where(
      and(
        eq(aiPricingRule.toolKey, toolKey),
        eq(aiPricingRule.featureKey, featureKey),
        eq(aiPricingRule.requestType, "chat"),
        eq(aiPricingRule.modelScope, "any"),
        eq(aiPricingRule.enabled, true)
      )
    )
    .limit(1);

  if (!defaultRule) {
    throw new AIGatewayError("pricing_rule_missing", "未找到可用计费规则", 500);
  }

  return defaultRule;
}

/**
 * 查询可用的 provider 候选。
 */
async function getCandidateBindings(
  modelKey: string,
  settings: ResolvedToolAISettings
): Promise<CandidateBinding[]> {
  const rows = await db
    .select({
      binding: aiRelayModelBinding,
      provider: aiRelayProvider,
    })
    .from(aiRelayModelBinding)
    .innerJoin(aiRelayProvider, eq(aiRelayModelBinding.providerId, aiRelayProvider.id))
    .where(
      and(
        eq(aiRelayModelBinding.modelKey, modelKey),
        eq(aiRelayModelBinding.enabled, true),
        eq(aiRelayProvider.enabled, true),
        eq(aiRelayProvider.requestType, "chat")
      )
    )
    .orderBy(
      asc(aiRelayModelBinding.priority),
      asc(aiRelayProvider.priority),
      desc(aiRelayModelBinding.weight),
      desc(aiRelayProvider.weight)
    );

  const filtered = rows.filter((row) => {
    if (
      settings.allowedProviderKeys.length > 0 &&
      !settings.allowedProviderKeys.includes(row.provider.key)
    ) {
      return false;
    }
    if (
      settings.routeStrategy === "primary_only" &&
      settings.preferredProviderKey &&
      row.provider.key !== settings.preferredProviderKey
    ) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    throw new AIGatewayError("provider_unavailable", "没有可用的 AI 中转站", 503);
  }

  if (settings.preferredProviderKey && settings.routeStrategy !== "weighted") {
    filtered.sort((left, right) => {
      if (left.provider.key === settings.preferredProviderKey) return -1;
      if (right.provider.key === settings.preferredProviderKey) return 1;
      return 0;
    });
  }

  if (settings.routeStrategy === "weighted") {
    return weightedOrder(filtered);
  }

  return filtered;
}

/**
 * 执行一次 AI chat 请求。
 */
export async function executeAIChat(
  params: ExecuteAIChatParams
): Promise<ExecuteAIChatResult> {
  if (params.stream) {
    throw new AIGatewayError("upstream_error", "当前阶段暂不支持流式返回", 400);
  }

  const settings = await resolveToolAISettings(
    params.userId,
    params.toolKey,
    params.featureKey,
    params.model
  );
  const pricingRule = await getPricingRule(
    params.toolKey,
    params.featureKey,
    settings.requestedModel
  );
  const minimumCredits = Math.max(
    pricingRule.minimumCredits,
    settings.featureConfig?.minimumCredits ?? 0
  );
  const balance = await getCreditsBalance(params.userId);

  if (balance.status === "frozen") {
    throw new AccountFrozenError(params.userId);
  }
  if (balance.balance < minimumCredits) {
    throw new InsufficientCreditsError(minimumCredits, balance.balance);
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  await db.insert(aiRequestLog).values({
    id: crypto.randomUUID(),
    requestId,
    userId: params.userId,
    toolKey: params.toolKey,
    featureKey: params.featureKey,
    requestType: "chat",
    requestedModel: settings.requestedModel,
    routeStrategy: settings.routeStrategy,
    status: "pending",
    billingMode: pricingRule.billingMode,
    requestBody: {
      messages: params.messages,
      model: params.model ?? null,
      temperature: params.temperature ?? null,
      stream: params.stream ?? false,
    },
    metadata: params.metadata,
  });

  const candidates = await getCandidateBindings(settings.requestedModel, settings);
  const attempts: Array<{
    candidate: CandidateBinding;
    result?: AIChatResult;
    latencyMs: number;
    providerCostMicros: number;
  }> = [];

  let finalError: unknown = null;

  for (const [index, candidate] of candidates.entries()) {
    const attemptNo = index + 1;
    const attemptStartedAt = Date.now();

    try {
      const result = await chatCompletionWithUsage(
        params.messages as never,
        {
          ...(params.temperature !== undefined
            ? { temperature: params.temperature }
            : {}),
          aiConfig: {
            provider: "openai",
            apiKey: decryptRelayApiKey(candidate.provider.apiKeyEncrypted),
            baseUrl: candidate.provider.baseUrl,
            model: candidate.binding.modelAlias,
          },
        }
      );
      const latencyMs = Date.now() - attemptStartedAt;
      const providerCostMicros = calculateProviderCostMicros(
        candidate.binding,
        result
      );

      await db.insert(aiRequestAttempt).values({
        id: crypto.randomUUID(),
        requestId,
        attemptNo,
        providerId: candidate.provider.id,
        providerKey: candidate.provider.key,
        modelKey: settings.requestedModel,
        modelAlias: candidate.binding.modelAlias,
        status: "success",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        providerCostUsd: providerCostMicros,
        latencyMs,
        responseMeta: {
          responseId: result.responseId,
          providerModel: result.model,
        },
      });

      attempts.push({
        candidate,
        result,
        latencyMs,
        providerCostMicros,
      });

      return await finalizeSuccessfulRequest({
        requestId,
        userId: params.userId,
        toolKey: params.toolKey,
        featureKey: params.featureKey,
        pricingRule,
        modelKey: settings.requestedModel,
        startedAt,
        attempts,
      });
    } catch (error) {
      finalError = error;
      const latencyMs = Date.now() - attemptStartedAt;
      const statusCode = getStatusCode(error);
      const errorMessage = getErrorMessage(error);

      await db.insert(aiRequestAttempt).values({
        id: crypto.randomUUID(),
        requestId,
        attemptNo,
        providerId: candidate.provider.id,
        providerKey: candidate.provider.key,
        modelKey: settings.requestedModel,
        modelAlias: candidate.binding.modelAlias,
        status: statusCode === 408 ? "timeout" : "failed",
        httpStatus: statusCode,
        latencyMs,
        errorCode: statusCode ? String(statusCode) : "upstream_error",
        errorMessage,
      });

      attempts.push({
        candidate,
        latencyMs,
        providerCostMicros: 0,
      });

      if (settings.routeStrategy === "primary_only") {
        break;
      }
    }
  }

  await db
    .update(aiRequestLog)
    .set({
      status: "failed",
      attemptCount: attempts.length,
      latencyMs: Date.now() - startedAt,
      errorCode: finalError instanceof Error ? finalError.name : "upstream_error",
      errorMessage: getErrorMessage(finalError),
      updatedAt: new Date(),
    })
    .where(eq(aiRequestLog.requestId, requestId));

  throw new AIGatewayError("upstream_error", "AI 上游请求失败", 502);
}

async function finalizeSuccessfulRequest(params: {
  requestId: string;
  userId: string;
  toolKey: string;
  featureKey: string;
  pricingRule: typeof aiPricingRule.$inferSelect;
  modelKey: string;
  startedAt: number;
  attempts: Array<{
    candidate: CandidateBinding;
    result?: AIChatResult;
    latencyMs: number;
    providerCostMicros: number;
  }>;
}): Promise<ExecuteAIChatResult> {
  const successfulAttempt = params.attempts.find((attempt) => attempt.result);
  if (!successfulAttempt?.result) {
    throw new Error("缺少成功请求结果");
  }

  const totalProviderCostMicros = params.attempts.reduce(
    (sum, attempt) => sum + attempt.providerCostMicros,
    0
  );
  const chargedCredits = calculateChargedCredits(
    params.pricingRule,
    successfulAttempt.result,
    totalProviderCostMicros
  );

  try {
    const consumeResult =
      chargedCredits > 0
        ? await consumeCredits({
            userId: params.userId,
            amount: chargedCredits,
            serviceName: `ai:${params.toolKey}:${params.featureKey}`,
            description: `${params.toolKey}/${params.featureKey} AI 调用扣费`,
            metadata: {
              requestId: params.requestId,
              toolKey: params.toolKey,
              featureKey: params.featureKey,
              modelKey: params.modelKey,
            },
          })
        : null;

    await db.insert(aiBillingRecord).values({
      id: crypto.randomUUID(),
      requestId: params.requestId,
      userId: params.userId,
      billingMode: params.pricingRule.billingMode,
      chargedCredits,
      creditsTransactionId: consumeResult?.transactionId ?? null,
      status: chargedCredits > 0 ? "charged" : "skipped",
      reason: chargedCredits > 0 ? "success" : "no_charge",
    });

    await db
      .update(aiRequestLog)
      .set({
        resolvedModel: successfulAttempt.candidate.binding.modelAlias,
        status: "success",
        promptTokens: successfulAttempt.result.usage.promptTokens,
        completionTokens: successfulAttempt.result.usage.completionTokens,
        totalTokens: successfulAttempt.result.usage.totalTokens,
        providerCostUsd: totalProviderCostMicros,
        chargedCredits,
        attemptCount: params.attempts.length,
        winningAttemptNo: params.attempts.findIndex((attempt) => attempt.result) + 1,
        latencyMs: Date.now() - params.startedAt,
        responseMeta: {
          responseId: successfulAttempt.result.responseId,
          providerKey: successfulAttempt.candidate.provider.key,
          providerModel: successfulAttempt.result.model,
        },
        updatedAt: new Date(),
      })
      .where(eq(aiRequestLog.requestId, params.requestId));

    return {
      requestId: params.requestId,
      provider: successfulAttempt.candidate.provider.key,
      model: params.modelKey,
      content: successfulAttempt.result.content,
      usage: successfulAttempt.result.usage,
      billing: {
        chargedCredits,
        billingMode: params.pricingRule.billingMode,
        remainingBalance: consumeResult?.remainingBalance ?? (await getCreditsBalance(params.userId)).balance,
      },
    };
  } catch (error) {
    await db
      .update(aiRequestLog)
      .set({
        status: error instanceof InsufficientCreditsError ? "insufficient_credits" : "billing_failed",
        attemptCount: params.attempts.length,
        winningAttemptNo: params.attempts.findIndex((attempt) => attempt.result) + 1,
        latencyMs: Date.now() - params.startedAt,
        errorCode:
          error instanceof Error ? error.name : "billing_failed",
        errorMessage: getErrorMessage(error),
        updatedAt: new Date(),
      })
      .where(eq(aiRequestLog.requestId, params.requestId));

    if (error instanceof InsufficientCreditsError) {
      throw error;
    }
    throw new AIGatewayError("billing_failed", "AI 请求成功，但扣费失败", 409);
  }
}

/**
 * 加密 AI 中转站密钥。
 */
export function encryptRelayApiKey(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * 解密 AI 中转站密钥。
 */
export function decryptRelayApiKey(payload: string): string {
  const [ivPart, authTagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("AI 中转站密钥格式错误");
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivPart, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * 获取加密密钥。
 */
function getEncryptionKey() {
  const secret = process.env.CONFIG_SECRET_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("缺少 CONFIG_SECRET_KEY 或 BETTER_AUTH_SECRET");
  }
  return createHash("sha256").update(secret).digest();
}

function parseRouteStrategy(value: string | null): AIRouteStrategy {
  if (value === "primary_only" || value === "weighted") {
    return value;
  }
  return "priority_failover";
}

function calculateProviderCostMicros(
  binding: AIRelayModelBinding,
  result: AIChatResult
) {
  if (binding.costMode === "fixed") {
    return binding.fixedCostUsd;
  }
  const inputCost =
    Math.ceil((result.usage.promptTokens * binding.inputCostPer1k) / 1000) || 0;
  const outputCost =
    Math.ceil((result.usage.completionTokens * binding.outputCostPer1k) / 1000) || 0;
  return inputCost + outputCost;
}

function calculateChargedCredits(
  rule: typeof aiPricingRule.$inferSelect,
  result: AIChatResult,
  totalProviderCostMicros: number
) {
  if (rule.billingMode === "fixed_credits") {
    return rule.fixedCredits ?? 0;
  }
  if (rule.billingMode === "token_based") {
    const inputCredits = rule.inputTokensPerCredit
      ? Math.ceil(result.usage.promptTokens / rule.inputTokensPerCredit)
      : 0;
    const outputCredits = rule.outputTokensPerCredit
      ? Math.ceil(result.usage.completionTokens / rule.outputTokensPerCredit)
      : 0;
    return Math.max(rule.minimumCredits, inputCredits + outputCredits);
  }
  if (!rule.costUsdPerCredit || rule.costUsdPerCredit <= 0) {
    return 0;
  }
  return Math.max(
    rule.minimumCredits,
    Math.ceil(totalProviderCostMicros / rule.costUsdPerCredit)
  );
}

function weightedOrder(items: CandidateBinding[]) {
  const pool = [...items];
  const sorted: CandidateBinding[] = [];

  while (pool.length > 0) {
    const totalWeight = pool.reduce(
      (sum, item) => sum + item.binding.weight + item.provider.weight,
      0
    );
    let cursor = Math.random() * totalWeight;

    const selectedIndex = pool.findIndex((item) => {
      cursor -= item.binding.weight + item.provider.weight;
      return cursor <= 0;
    });
    const index = selectedIndex >= 0 ? selectedIndex : 0;
    sorted.push(pool[index]!);
    pool.splice(index, 1);
  }

  return sorted;
}

function getStatusCode(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Reflect.get(error, "status");
    return typeof status === "number" ? status : null;
  }
  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}
