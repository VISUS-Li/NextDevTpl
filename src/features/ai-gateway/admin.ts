import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  aiBillingRecord,
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  aiRequestAttempt,
  aiRequestLog,
  user,
  type AIBillingMode,
} from "@/db/schema";
import { consumeCredits, grantCredits } from "@/features/credits/core";
import { chatCompletionWithUsage } from "@/lib/ai";

import { decryptRelayApiKey, encryptRelayApiKey } from "./service";

type ProviderStatsRow = typeof aiRelayProvider.$inferSelect & {
  totalAttempts: number;
  successAttempts: number;
  failedAttempts: number;
  averageLatencyMs: number;
  totalProviderCostMicros: number;
};

type ListRequestLogParams = {
  limit?: number;
  status?: typeof aiRequestLog.$inferSelect.status | undefined;
  toolKey?: string | undefined;
};

type SaveProviderInput = {
  key: string;
  name: string;
  baseUrl: string;
  apiKey?: string | undefined;
  enabled: boolean;
  priority: number;
  weight: number;
  requestType: "chat";
};

type SaveModelBindingInput = {
  providerId: string;
  modelKey: string;
  modelAlias: string;
  enabled: boolean;
  priority: number;
  weight: number;
  costMode: "manual" | "fixed";
  inputCostPer1k: number;
  outputCostPer1k: number;
  fixedCostUsd: number;
  maxRetries: number;
  timeoutMs: number;
};

type UpdateProviderInput = {
  key?: string | undefined;
  name?: string | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  weight?: number | undefined;
  requestType?: "chat" | undefined;
};

type UpdateModelBindingInput = {
  providerId?: string | undefined;
  modelKey?: string | undefined;
  modelAlias?: string | undefined;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  weight?: number | undefined;
  costMode?: "manual" | "fixed" | undefined;
  inputCostPer1k?: number | undefined;
  outputCostPer1k?: number | undefined;
  fixedCostUsd?: number | undefined;
  maxRetries?: number | undefined;
  timeoutMs?: number | undefined;
};

type SavePricingRuleInput = {
  toolKey: string;
  featureKey: string;
  requestType: "chat";
  billingMode: AIBillingMode;
  modelScope: string;
  fixedCredits: number | null;
  inputTokensPerCredit: number | null;
  outputTokensPerCredit: number | null;
  costUsdPerCredit: number | null;
  minimumCredits: number;
  enabled: boolean;
};

type UpdatePricingRuleInput = {
  toolKey?: string | undefined;
  featureKey?: string | undefined;
  requestType?: "chat" | undefined;
  billingMode?: AIBillingMode | undefined;
  modelScope?: string | undefined;
  fixedCredits?: number | null | undefined;
  inputTokensPerCredit?: number | null | undefined;
  outputTokensPerCredit?: number | null | undefined;
  costUsdPerCredit?: number | null | undefined;
  minimumCredits?: number | undefined;
  enabled?: boolean | undefined;
};

type HealthCheckParams = {
  providerIds?: string[] | undefined;
  disableOnFailure?: boolean | undefined;
};

type BillingAdjustmentParams = {
  requestId: string;
  operatorUserId: string;
  direction: "refund" | "charge";
  credits: number;
  reason: string;
};

type AlertQueryParams = {
  costAlertMicros?: number | undefined;
  failureRateThreshold?: number | undefined;
};

/**
 * 读取 AI Provider 列表和聚合指标。
 */
export async function listAIProviders(): Promise<ProviderStatsRow[]> {
  const rows = await db
    .select({
      id: aiRelayProvider.id,
      key: aiRelayProvider.key,
      name: aiRelayProvider.name,
      providerType: aiRelayProvider.providerType,
      baseUrl: aiRelayProvider.baseUrl,
      apiKeyEncrypted: aiRelayProvider.apiKeyEncrypted,
      enabled: aiRelayProvider.enabled,
      priority: aiRelayProvider.priority,
      weight: aiRelayProvider.weight,
      requestType: aiRelayProvider.requestType,
      metadata: aiRelayProvider.metadata,
      lastHealthAt: aiRelayProvider.lastHealthAt,
      lastHealthStatus: aiRelayProvider.lastHealthStatus,
      createdAt: aiRelayProvider.createdAt,
      updatedAt: aiRelayProvider.updatedAt,
      totalAttempts: sql<number>`count(${aiRequestAttempt.id})`,
      successAttempts:
        sql<number>`count(${aiRequestAttempt.id}) filter (where ${aiRequestAttempt.status} = 'success')`,
      failedAttempts:
        sql<number>`count(${aiRequestAttempt.id}) filter (where ${aiRequestAttempt.status} <> 'success')`,
      averageLatencyMs:
        sql<number>`coalesce(avg(${aiRequestAttempt.latencyMs}), 0)`,
      totalProviderCostMicros:
        sql<number>`coalesce(sum(${aiRequestAttempt.providerCostUsd}), 0)`,
    })
    .from(aiRelayProvider)
    .leftJoin(aiRequestAttempt, eq(aiRequestAttempt.providerId, aiRelayProvider.id))
    .groupBy(aiRelayProvider.id)
    .orderBy(
      aiRelayProvider.priority,
      desc(aiRelayProvider.enabled),
      aiRelayProvider.key
    );

  return rows.map((row) => ({
    ...row,
    totalAttempts: Number(row.totalAttempts ?? 0),
    successAttempts: Number(row.successAttempts ?? 0),
    failedAttempts: Number(row.failedAttempts ?? 0),
    averageLatencyMs: Number(row.averageLatencyMs ?? 0),
    totalProviderCostMicros: Number(row.totalProviderCostMicros ?? 0),
  }));
}

/**
 * 新增 AI Provider。
 */
export async function createAIProvider(input: SaveProviderInput) {
  const [created] = await db
    .insert(aiRelayProvider)
    .values({
      id: crypto.randomUUID(),
      key: input.key,
      name: input.name,
      providerType: "openai_compatible",
      baseUrl: input.baseUrl,
      apiKeyEncrypted: encryptRelayApiKey(input.apiKey ?? ""),
      enabled: input.enabled,
      priority: input.priority,
      weight: input.weight,
      requestType: input.requestType,
    })
    .returning();

  return created;
}

/**
 * 更新 AI Provider。
 */
export async function updateAIProvider(
  providerId: string,
  input: UpdateProviderInput
) {
  const [current] = await db
    .select()
    .from(aiRelayProvider)
    .where(eq(aiRelayProvider.id, providerId))
    .limit(1);

  if (!current) {
    throw new Error("Provider 不存在");
  }

  const [updated] = await db
    .update(aiRelayProvider)
    .set({
      ...(input.key ? { key: input.key } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey !== undefined
        ? { apiKeyEncrypted: encryptRelayApiKey(input.apiKey) }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.requestType ? { requestType: input.requestType } : {}),
      updatedAt: new Date(),
    })
    .where(eq(aiRelayProvider.id, providerId))
    .returning();

  return updated;
}

/**
 * 删除 AI Provider。
 */
export async function deleteAIProvider(providerId: string) {
  await db.delete(aiRelayProvider).where(eq(aiRelayProvider.id, providerId));
}

/**
 * 读取 AI Model Binding 列表。
 */
export async function listAIModelBindings() {
  return db
    .select({
      id: aiRelayModelBinding.id,
      providerId: aiRelayModelBinding.providerId,
      providerKey: aiRelayProvider.key,
      providerName: aiRelayProvider.name,
      modelKey: aiRelayModelBinding.modelKey,
      modelAlias: aiRelayModelBinding.modelAlias,
      enabled: aiRelayModelBinding.enabled,
      priority: aiRelayModelBinding.priority,
      weight: aiRelayModelBinding.weight,
      costMode: aiRelayModelBinding.costMode,
      inputCostPer1k: aiRelayModelBinding.inputCostPer1k,
      outputCostPer1k: aiRelayModelBinding.outputCostPer1k,
      fixedCostUsd: aiRelayModelBinding.fixedCostUsd,
      maxRetries: aiRelayModelBinding.maxRetries,
      timeoutMs: aiRelayModelBinding.timeoutMs,
      metadata: aiRelayModelBinding.metadata,
      createdAt: aiRelayModelBinding.createdAt,
      updatedAt: aiRelayModelBinding.updatedAt,
    })
    .from(aiRelayModelBinding)
    .innerJoin(aiRelayProvider, eq(aiRelayModelBinding.providerId, aiRelayProvider.id))
    .orderBy(aiRelayProvider.priority, aiRelayModelBinding.priority, aiRelayModelBinding.modelKey);
}

/**
 * 新增 AI Model Binding。
 */
export async function createAIModelBinding(input: SaveModelBindingInput) {
  const [created] = await db
    .insert(aiRelayModelBinding)
    .values({
      id: crypto.randomUUID(),
      providerId: input.providerId,
      modelKey: input.modelKey,
      modelAlias: input.modelAlias,
      enabled: input.enabled,
      priority: input.priority,
      weight: input.weight,
      costMode: input.costMode,
      inputCostPer1k: input.inputCostPer1k,
      outputCostPer1k: input.outputCostPer1k,
      fixedCostUsd: input.fixedCostUsd,
      maxRetries: input.maxRetries,
      timeoutMs: input.timeoutMs,
    })
    .returning();

  return created;
}

/**
 * 更新 AI Model Binding。
 */
export async function updateAIModelBinding(
  bindingId: string,
  input: UpdateModelBindingInput
) {
  const [updated] = await db
    .update(aiRelayModelBinding)
    .set({
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelKey ? { modelKey: input.modelKey } : {}),
      ...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.costMode ? { costMode: input.costMode } : {}),
      ...(input.inputCostPer1k !== undefined
        ? { inputCostPer1k: input.inputCostPer1k }
        : {}),
      ...(input.outputCostPer1k !== undefined
        ? { outputCostPer1k: input.outputCostPer1k }
        : {}),
      ...(input.fixedCostUsd !== undefined
        ? { fixedCostUsd: input.fixedCostUsd }
        : {}),
      ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      updatedAt: new Date(),
    })
    .where(eq(aiRelayModelBinding.id, bindingId))
    .returning();

  return updated;
}

/**
 * 删除 AI Model Binding。
 */
export async function deleteAIModelBinding(bindingId: string) {
  await db
    .delete(aiRelayModelBinding)
    .where(eq(aiRelayModelBinding.id, bindingId));
}

/**
 * 读取 AI 计费规则列表。
 */
export async function listAIPricingRules() {
  return db
    .select()
    .from(aiPricingRule)
    .orderBy(aiPricingRule.toolKey, aiPricingRule.featureKey, aiPricingRule.modelScope);
}

/**
 * 新增 AI 计费规则。
 */
export async function createAIPricingRule(input: SavePricingRuleInput) {
  const [created] = await db
    .insert(aiPricingRule)
    .values({
      id: crypto.randomUUID(),
      ...input,
    })
    .returning();

  return created;
}

/**
 * 更新 AI 计费规则。
 */
export async function updateAIPricingRule(
  ruleId: string,
  input: UpdatePricingRuleInput
) {
  const [updated] = await db
    .update(aiPricingRule)
    .set({
      ...(input.toolKey ? { toolKey: input.toolKey } : {}),
      ...(input.featureKey ? { featureKey: input.featureKey } : {}),
      ...(input.requestType ? { requestType: input.requestType } : {}),
      ...(input.billingMode ? { billingMode: input.billingMode } : {}),
      ...(input.modelScope ? { modelScope: input.modelScope } : {}),
      ...(input.fixedCredits !== undefined ? { fixedCredits: input.fixedCredits } : {}),
      ...(input.inputTokensPerCredit !== undefined
        ? { inputTokensPerCredit: input.inputTokensPerCredit }
        : {}),
      ...(input.outputTokensPerCredit !== undefined
        ? { outputTokensPerCredit: input.outputTokensPerCredit }
        : {}),
      ...(input.costUsdPerCredit !== undefined
        ? { costUsdPerCredit: input.costUsdPerCredit }
        : {}),
      ...(input.minimumCredits !== undefined
        ? { minimumCredits: input.minimumCredits }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(aiPricingRule.id, ruleId))
    .returning();

  return updated;
}

/**
 * 删除 AI 计费规则。
 */
export async function deleteAIPricingRule(ruleId: string) {
  await db.delete(aiPricingRule).where(eq(aiPricingRule.id, ruleId));
}

/**
 * 读取 AI 请求明细列表。
 */
export async function listAIRequestLogs(params: ListRequestLogParams = {}) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const conditions = [
    params.status ? eq(aiRequestLog.status, params.status) : undefined,
    params.toolKey ? eq(aiRequestLog.toolKey, params.toolKey) : undefined,
  ].filter(Boolean);

  const requests = await db
    .select({
      id: aiRequestLog.id,
      requestId: aiRequestLog.requestId,
      userId: aiRequestLog.userId,
      userEmail: user.email,
      userName: user.name,
      toolKey: aiRequestLog.toolKey,
      featureKey: aiRequestLog.featureKey,
      requestedModel: aiRequestLog.requestedModel,
      resolvedModel: aiRequestLog.resolvedModel,
      routeStrategy: aiRequestLog.routeStrategy,
      status: aiRequestLog.status,
      billingMode: aiRequestLog.billingMode,
      promptTokens: aiRequestLog.promptTokens,
      completionTokens: aiRequestLog.completionTokens,
      totalTokens: aiRequestLog.totalTokens,
      providerCostUsd: aiRequestLog.providerCostUsd,
      chargedCredits: aiRequestLog.chargedCredits,
      attemptCount: aiRequestLog.attemptCount,
      winningAttemptNo: aiRequestLog.winningAttemptNo,
      latencyMs: aiRequestLog.latencyMs,
      errorCode: aiRequestLog.errorCode,
      errorMessage: aiRequestLog.errorMessage,
      createdAt: aiRequestLog.createdAt,
    })
    .from(aiRequestLog)
    .innerJoin(user, eq(user.id, aiRequestLog.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiRequestLog.createdAt))
    .limit(limit);

  const requestIds = requests.map((item) => item.requestId);
  const attempts =
    requestIds.length === 0
      ? []
      : await db
          .select({
            requestId: aiRequestAttempt.requestId,
            attemptNo: aiRequestAttempt.attemptNo,
            providerKey: aiRequestAttempt.providerKey,
            modelAlias: aiRequestAttempt.modelAlias,
            status: aiRequestAttempt.status,
          })
          .from(aiRequestAttempt)
          .where(inArray(aiRequestAttempt.requestId, requestIds));

  const winningAttemptMap = new Map(
    attempts.map((item) => [`${item.requestId}:${item.attemptNo}`, item])
  );

  return requests.map((item) => ({
    ...item,
    providerKey:
      item.winningAttemptNo === null
        ? null
        : winningAttemptMap.get(`${item.requestId}:${item.winningAttemptNo}`)?.providerKey ??
          null,
    providerModel:
      item.winningAttemptNo === null
        ? null
        : winningAttemptMap.get(`${item.requestId}:${item.winningAttemptNo}`)?.modelAlias ??
          null,
  }));
}

/**
 * 运行 Provider 健康检查。
 */
export async function runAIProviderHealthCheck(params: HealthCheckParams = {}) {
  const providers = await db
    .select()
    .from(aiRelayProvider)
    .where(
      params.providerIds?.length
        ? inArray(aiRelayProvider.id, params.providerIds)
        : eq(aiRelayProvider.enabled, true)
    )
    .orderBy(aiRelayProvider.priority, aiRelayProvider.key);

  const bindings = await db
    .select()
    .from(aiRelayModelBinding)
    .where(eq(aiRelayModelBinding.enabled, true))
    .orderBy(aiRelayModelBinding.priority, aiRelayModelBinding.modelKey);

  const bindingMap = new Map<string, typeof aiRelayModelBinding.$inferSelect>();
  for (const binding of bindings) {
    if (!bindingMap.has(binding.providerId)) {
      bindingMap.set(binding.providerId, binding);
    }
  }

  const results = [];

  for (const provider of providers) {
    const binding = bindingMap.get(provider.id);
    if (!binding) {
      await db
        .update(aiRelayProvider)
        .set({
          lastHealthAt: new Date(),
          lastHealthStatus: "degraded",
          ...(params.disableOnFailure ? { enabled: false } : {}),
          updatedAt: new Date(),
        })
        .where(eq(aiRelayProvider.id, provider.id));

      results.push({
        providerId: provider.id,
        providerKey: provider.key,
        ok: false,
        status: "degraded",
        message: "未找到可用模型绑定",
      });
      continue;
    }

    try {
      await chatCompletionWithUsage(
        [{ role: "user", content: "reply ok" }],
        {
          temperature: 0,
          maxTokens: 16,
          aiConfig: {
            provider: "openai",
            apiKey: decryptRelayApiKey(provider.apiKeyEncrypted),
            baseUrl: provider.baseUrl,
            model: binding.modelAlias,
          },
        }
      );

      await db
        .update(aiRelayProvider)
        .set({
          lastHealthAt: new Date(),
          lastHealthStatus: "healthy",
          updatedAt: new Date(),
        })
        .where(eq(aiRelayProvider.id, provider.id));

      results.push({
        providerId: provider.id,
        providerKey: provider.key,
        ok: true,
        status: "healthy",
        message: "健康检查通过",
      });
    } catch (error) {
      await db
        .update(aiRelayProvider)
        .set({
          lastHealthAt: new Date(),
          lastHealthStatus: "down",
          ...(params.disableOnFailure ? { enabled: false } : {}),
          updatedAt: new Date(),
        })
        .where(eq(aiRelayProvider.id, provider.id));

      results.push({
        providerId: provider.id,
        providerKey: provider.key,
        ok: false,
        status: "down",
        message: error instanceof Error ? error.message : "健康检查失败",
      });
    }
  }

  return results;
}

/**
 * 执行管理员手工调账。
 */
export async function createAIBillingAdjustment(params: BillingAdjustmentParams) {
  const [request] = await db
    .select()
    .from(aiRequestLog)
    .where(eq(aiRequestLog.requestId, params.requestId))
    .limit(1);

  if (!request) {
    throw new Error("请求不存在");
  }

  if (params.direction === "refund") {
    const result = await grantCredits({
      userId: request.userId,
      amount: params.credits,
      sourceType: "refund",
      debitAccount: "SYSTEM:AI_ADJUSTMENT",
      transactionType: "refund",
      sourceRef: params.requestId,
      description: `AI 调账退款：${params.reason}`,
      metadata: {
        requestId: params.requestId,
        operatorUserId: params.operatorUserId,
      },
    });

    const [record] = await db
      .insert(aiBillingRecord)
      .values({
        id: crypto.randomUUID(),
        requestId: params.requestId,
        userId: request.userId,
        billingMode: request.billingMode,
        chargedCredits: -params.credits,
        creditsTransactionId: result.transactionId,
        status: "reversed",
        reason: params.reason,
      })
      .returning();

    return record;
  }

  const result = await consumeCredits({
    userId: request.userId,
    amount: params.credits,
    serviceName: "ai_manual_adjustment",
    description: `AI 手工补扣：${params.reason}`,
    metadata: {
      requestId: params.requestId,
      operatorUserId: params.operatorUserId,
    },
  });

  const [record] = await db
    .insert(aiBillingRecord)
    .values({
      id: crypto.randomUUID(),
      requestId: params.requestId,
      userId: request.userId,
      billingMode: request.billingMode,
      chargedCredits: params.credits,
      creditsTransactionId: result.transactionId,
      status: "charged",
      reason: params.reason,
    })
    .returning();

  return record;
}

/**
 * 读取 AI 运维告警。
 */
export async function getAIOperationAlerts(params: AlertQueryParams = {}) {
  const providers = await listAIProviders();
  const failureRateThreshold = params.failureRateThreshold ?? 0.5;
  const costAlertMicros = params.costAlertMicros ?? 50_000;

  const highCostRequests = await db
    .select({
      requestId: aiRequestLog.requestId,
      toolKey: aiRequestLog.toolKey,
      featureKey: aiRequestLog.featureKey,
      providerCostUsd: aiRequestLog.providerCostUsd,
      createdAt: aiRequestLog.createdAt,
    })
    .from(aiRequestLog)
    .where(
      and(
        eq(aiRequestLog.status, "success"),
        sql`${aiRequestLog.providerCostUsd} >= ${costAlertMicros}`
      )
    )
    .orderBy(desc(aiRequestLog.providerCostUsd))
    .limit(20);

  return {
    providers: providers
      .filter((item) => {
        const failureRate =
          item.totalAttempts === 0 ? 0 : item.failedAttempts / item.totalAttempts;
        return item.lastHealthStatus === "down" || failureRate >= failureRateThreshold;
      })
      .map((item) => ({
        providerKey: item.key,
        healthStatus: item.lastHealthStatus,
        failureRate:
          item.totalAttempts === 0 ? 0 : item.failedAttempts / item.totalAttempts,
        totalAttempts: item.totalAttempts,
      })),
    highCostRequests,
  };
}

/**
 * 读取管理后台首页数据。
 */
export async function getAIGatewayAdminPageData() {
  const [providers, bindings, pricingRules, requests] = await Promise.all([
    listAIProviders(),
    listAIModelBindings(),
    listAIPricingRules(),
    listAIRequestLogs({ limit: 20 }),
  ]);

  return {
    providers,
    bindings,
    pricingRules,
    requests,
  };
}
