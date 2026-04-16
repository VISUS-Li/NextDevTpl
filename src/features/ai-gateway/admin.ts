import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type AIBillingMode,
  aiBillingRecord,
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  aiRequestAttempt,
  aiRequestLog,
  user,
} from "@/db/schema";
import { consumeCredits, grantCredits } from "@/features/credits/core";
import { chatCompletionWithUsage } from "@/lib/ai";

import { decryptRelayApiKey, encryptRelayApiKey } from "./service";

export const AI_MODEL_CAPABILITIES = [
  "text",
  "image_input",
  "image_generation",
  "audio_input",
  "audio_generation",
  "file_input",
  "video_input",
  "video_generation",
] as const;

export type AIModelCapability = (typeof AI_MODEL_CAPABILITIES)[number];

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
  capabilities: AIModelCapability[];
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
  capabilities?: AIModelCapability[] | undefined;
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

type GeekPresetTier = "cheap" | "standard" | "premium";

type GeekPresetPricingProfile =
  | "text_basic"
  | "text_long"
  | "multimodal_basic"
  | "multimodal_heavy"
  | "async_media";

type GeekPresetModelInput = {
  modelKey: string;
  modelAlias: string;
  capabilities?: AIModelCapability[] | undefined;
  tier?: GeekPresetTier | undefined;
  timeoutMs?: number | undefined;
};

type GeekPresetRuleInput = {
  toolKey: string;
  featureKey: string;
  profile?: GeekPresetPricingProfile | undefined;
  modelScope?: string | undefined;
};

type ApplyGeekPresetInput = {
  apiKey: string;
  providerKey: string;
  providerName: string;
  baseUrl: string;
  models: GeekPresetModelInput[];
  pricingRules: GeekPresetRuleInput[];
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
      successAttempts: sql<number>`count(${aiRequestAttempt.id}) filter (where ${aiRequestAttempt.status} = 'success')`,
      failedAttempts: sql<number>`count(${aiRequestAttempt.id}) filter (where ${aiRequestAttempt.status} <> 'success')`,
      averageLatencyMs: sql<number>`coalesce(avg(${aiRequestAttempt.latencyMs}), 0)`,
      totalProviderCostMicros: sql<number>`coalesce(sum(${aiRequestAttempt.providerCostUsd}), 0)`,
    })
    .from(aiRelayProvider)
    .leftJoin(
      aiRequestAttempt,
      eq(aiRequestAttempt.providerId, aiRelayProvider.id)
    )
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
 * 应用 Geek 预设配置。
 *
 * 这里的费率是平台侧推荐默认值，用于尽快起步。
 * 它们不是 Geek 官方计费标准，后续应按你的实际账单再调整。
 */
export async function applyGeekPreset(input: ApplyGeekPresetInput) {
  const [existingProvider] = await db
    .select()
    .from(aiRelayProvider)
    .where(eq(aiRelayProvider.key, input.providerKey))
    .limit(1);

  const providerId = existingProvider?.id ?? crypto.randomUUID();

  if (existingProvider) {
    await db
      .update(aiRelayProvider)
      .set({
        name: input.providerName,
        baseUrl: input.baseUrl,
        apiKeyEncrypted: encryptRelayApiKey(input.apiKey),
        enabled: true,
        priority: 10,
        weight: 100,
        requestType: "chat",
        metadata: {
          preset: "geek",
          note: "由 Geek 预设接口维护",
        },
        updatedAt: new Date(),
      })
      .where(eq(aiRelayProvider.id, existingProvider.id));
  } else {
    await db.insert(aiRelayProvider).values({
      id: providerId,
      key: input.providerKey,
      name: input.providerName,
      providerType: "openai_compatible",
      baseUrl: input.baseUrl,
      apiKeyEncrypted: encryptRelayApiKey(input.apiKey),
      enabled: true,
      priority: 10,
      weight: 100,
      requestType: "chat",
      metadata: {
        preset: "geek",
        note: "由 Geek 预设接口创建",
      },
    });
  }

  for (const model of input.models) {
    const [existingBinding] = await db
      .select()
      .from(aiRelayModelBinding)
      .where(
        and(
          eq(aiRelayModelBinding.providerId, providerId),
          eq(aiRelayModelBinding.modelKey, model.modelKey)
        )
      )
      .limit(1);

    const bindingValues = getGeekBindingPreset(model);

    if (existingBinding) {
      await db
        .update(aiRelayModelBinding)
        .set({
          modelAlias: model.modelAlias,
          enabled: true,
          priority: bindingValues.priority,
          weight: bindingValues.weight,
          costMode: "manual",
          inputCostPer1k: bindingValues.inputCostPer1k,
          outputCostPer1k: bindingValues.outputCostPer1k,
          timeoutMs: bindingValues.timeoutMs,
          metadata: {
            preset: "geek",
            tier: bindingValues.tier,
            capabilities: bindingValues.capabilities,
            endpointType: bindingValues.transport.endpointType,
            pollType: bindingValues.transport.pollType,
            operations: bindingValues.transport.operations,
          },
          updatedAt: new Date(),
        })
        .where(eq(aiRelayModelBinding.id, existingBinding.id));
    } else {
      await db.insert(aiRelayModelBinding).values({
        id: crypto.randomUUID(),
        providerId,
        modelKey: model.modelKey,
        modelAlias: model.modelAlias,
        enabled: true,
        priority: bindingValues.priority,
        weight: bindingValues.weight,
        costMode: "manual",
        inputCostPer1k: bindingValues.inputCostPer1k,
        outputCostPer1k: bindingValues.outputCostPer1k,
        timeoutMs: bindingValues.timeoutMs,
        metadata: {
          preset: "geek",
          tier: bindingValues.tier,
          capabilities: bindingValues.capabilities,
          endpointType: bindingValues.transport.endpointType,
          pollType: bindingValues.transport.pollType,
          operations: bindingValues.transport.operations,
        },
      });
    }
  }

  for (const rule of input.pricingRules) {
    const pricingValues = getGeekPricingPreset(rule.profile);
    const modelScope = rule.modelScope ?? "any";
    const [existingRule] = await db
      .select()
      .from(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, rule.toolKey),
          eq(aiPricingRule.featureKey, rule.featureKey),
          eq(aiPricingRule.requestType, "chat"),
          eq(aiPricingRule.modelScope, modelScope)
        )
      )
      .limit(1);

    if (existingRule) {
      await db
        .update(aiPricingRule)
        .set({
          billingMode: pricingValues.billingMode,
          fixedCredits: pricingValues.fixedCredits,
          inputTokensPerCredit: pricingValues.inputTokensPerCredit,
          outputTokensPerCredit: pricingValues.outputTokensPerCredit,
          costUsdPerCredit: pricingValues.costUsdPerCredit,
          minimumCredits: pricingValues.minimumCredits,
          enabled: true,
          updatedAt: new Date(),
        })
        .where(eq(aiPricingRule.id, existingRule.id));
    } else {
      await db.insert(aiPricingRule).values({
        id: crypto.randomUUID(),
        toolKey: rule.toolKey,
        featureKey: rule.featureKey,
        requestType: "chat",
        billingMode: pricingValues.billingMode,
        modelScope,
        fixedCredits: pricingValues.fixedCredits,
        inputTokensPerCredit: pricingValues.inputTokensPerCredit,
        outputTokensPerCredit: pricingValues.outputTokensPerCredit,
        costUsdPerCredit: pricingValues.costUsdPerCredit,
        minimumCredits: pricingValues.minimumCredits,
        enabled: true,
      });
    }
  }

  const [provider] = await db
    .select()
    .from(aiRelayProvider)
    .where(eq(aiRelayProvider.id, providerId))
    .limit(1);

  const bindings = await db
    .select()
    .from(aiRelayModelBinding)
    .where(eq(aiRelayModelBinding.providerId, providerId))
    .orderBy(aiRelayModelBinding.priority, aiRelayModelBinding.modelKey);

  const pricingRules = await db
    .select()
    .from(aiPricingRule)
    .where(
      and(
        inArray(
          aiPricingRule.featureKey,
          input.pricingRules.map((item) => item.featureKey)
        ),
        inArray(
          aiPricingRule.toolKey,
          input.pricingRules.map((item) => item.toolKey)
        )
      )
    );

  return {
    provider,
    bindings,
    pricingRules,
  };
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
 * 按模型档位生成默认成本配置。
 */
function getGeekBindingPreset(model: GeekPresetModelInput) {
  const capabilities =
    model.capabilities ??
    inferCapabilitiesFromModelName(model.modelKey, model.modelAlias);
  const transport = inferBindingTransportMetadata(
    model.modelKey,
    model.modelAlias,
    capabilities
  );
  const tier = model.tier ?? "standard";
  if (tier === "cheap") {
    return {
      capabilities,
      transport,
      tier,
      priority: 10,
      weight: 100,
      inputCostPer1k: 200,
      outputCostPer1k: 800,
      timeoutMs: model.timeoutMs ?? 30000,
    };
  }
  if (tier === "premium") {
    return {
      capabilities,
      transport,
      tier,
      priority: 10,
      weight: 100,
      inputCostPer1k: 1500,
      outputCostPer1k: 6000,
      timeoutMs: model.timeoutMs ?? 60000,
    };
  }
  return {
    capabilities,
    transport,
    tier,
    priority: 10,
    weight: 100,
    inputCostPer1k: 500,
    outputCostPer1k: 2000,
    timeoutMs: model.timeoutMs ?? 45000,
  };
}

/**
 * 按业务场景生成平台侧默认计费规则。
 */
function getGeekPricingPreset(
  profile: GeekPresetPricingProfile = "text_basic"
) {
  if (profile === "text_long") {
    return {
      billingMode: "token_based" as const,
      fixedCredits: null,
      inputTokensPerCredit: 600,
      outputTokensPerCredit: 300,
      costUsdPerCredit: null,
      minimumCredits: 2,
    };
  }
  if (profile === "multimodal_basic") {
    return {
      billingMode: "token_based" as const,
      fixedCredits: null,
      inputTokensPerCredit: 400,
      outputTokensPerCredit: 200,
      costUsdPerCredit: null,
      minimumCredits: 3,
    };
  }
  if (profile === "multimodal_heavy") {
    return {
      billingMode: "token_based" as const,
      fixedCredits: null,
      inputTokensPerCredit: 250,
      outputTokensPerCredit: 120,
      costUsdPerCredit: null,
      minimumCredits: 5,
    };
  }
  if (profile === "async_media") {
    return {
      billingMode: "fixed_credits" as const,
      fixedCredits: 8,
      inputTokensPerCredit: null,
      outputTokensPerCredit: null,
      costUsdPerCredit: null,
      minimumCredits: 8,
    };
  }
  return {
    billingMode: "fixed_credits" as const,
    fixedCredits: 2,
    inputTokensPerCredit: null,
    outputTokensPerCredit: null,
    costUsdPerCredit: null,
    minimumCredits: 2,
  };
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
  const rows = await db
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
    .innerJoin(
      aiRelayProvider,
      eq(aiRelayModelBinding.providerId, aiRelayProvider.id)
    )
    .orderBy(
      aiRelayProvider.priority,
      aiRelayModelBinding.priority,
      aiRelayModelBinding.modelKey
    );

  return rows.map((row) => ({
    ...row,
    capabilities: readBindingCapabilities(row.metadata),
  }));
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
      metadata: {
        capabilities: input.capabilities,
        ...inferBindingTransportMetadata(
          input.modelKey,
          input.modelAlias,
          input.capabilities
        ),
      },
    })
    .returning();

  if (!created) {
    throw new Error("模型绑定创建失败");
  }

  return {
    ...created,
    capabilities: readBindingCapabilities(created.metadata),
  };
}

/**
 * 更新 AI Model Binding。
 */
export async function updateAIModelBinding(
  bindingId: string,
  input: UpdateModelBindingInput
) {
  const [current] = await db
    .select()
    .from(aiRelayModelBinding)
    .where(eq(aiRelayModelBinding.id, bindingId))
    .limit(1);

  if (!current) {
    throw new Error("模型绑定不存在");
  }

  const metadata = {
    ...(isRecord(current.metadata) ? current.metadata : {}),
    ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    ...inferBindingTransportMetadata(
      input.modelKey ?? current.modelKey,
      input.modelAlias ?? current.modelAlias,
      input.capabilities ?? readBindingCapabilities(current.metadata)
    ),
  };

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
      ...(input.maxRetries !== undefined
        ? { maxRetries: input.maxRetries }
        : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(aiRelayModelBinding.id, bindingId))
    .returning();

  if (!updated) {
    throw new Error("模型绑定更新失败");
  }

  return {
    ...updated,
    capabilities: readBindingCapabilities(updated.metadata),
  };
}

function readBindingCapabilities(value: unknown): AIModelCapability[] {
  const capabilities = isRecord(value) ? value.capabilities : null;
  if (!Array.isArray(capabilities)) {
    return ["text"];
  }
  return capabilities.filter(
    (item): item is AIModelCapability =>
      typeof item === "string" &&
      (AI_MODEL_CAPABILITIES as readonly string[]).includes(item)
  );
}

function inferCapabilitiesFromModelName(modelKey: string, modelAlias: string) {
  const fingerprint = `${modelKey} ${modelAlias}`.toLowerCase();
  const capabilities: AIModelCapability[] = ["text"];

  if (fingerprint.includes("vision") || fingerprint.includes("gemini")) {
    capabilities.push("image_input");
  }
  if (
    fingerprint.includes("image") ||
    fingerprint.includes("img") ||
    fingerprint.includes("nano banana")
  ) {
    capabilities.push("image_input", "image_generation");
  }
  if (fingerprint.includes("audio")) {
    capabilities.push("audio_input", "audio_generation");
  }
  if (fingerprint.includes("file") || fingerprint.includes("pdf")) {
    capabilities.push("file_input");
  }
  if (fingerprint.includes("video")) {
    capabilities.push("video_input", "video_generation");
  }

  return Array.from(new Set(capabilities));
}

function inferBindingTransportMetadata(
  modelKey: string,
  modelAlias: string,
  capabilities: AIModelCapability[]
) {
  const fingerprint = `${modelKey} ${modelAlias}`.toLowerCase();

  if (/sora|veo|kling|cogvideo|wanx|hunyuan.*video/.test(fingerprint)) {
    return {
      endpointType: "videos_generations" as const,
      pollType: "video" as const,
      operations: ["video.generate"],
    };
  }
  if (/nano-banana|gpt-image-1/.test(fingerprint)) {
    return {
      endpointType: "images_generations" as const,
      pollType: "image" as const,
      operations: ["image.generate", "image.edit"],
    };
  }

  const operations = new Set<string>();
  if (capabilities.includes("text")) {
    operations.add("text.generate");
  }
  if (capabilities.includes("image_input")) {
    operations.add("image.understand");
  }
  if (capabilities.includes("audio_input")) {
    operations.add("audio.understand");
  }
  if (capabilities.includes("file_input")) {
    operations.add("file.understand");
  }
  if (capabilities.includes("video_input")) {
    operations.add("video.understand");
  }
  if (capabilities.includes("image_generation")) {
    operations.add("image.generate");
  }
  if (capabilities.includes("audio_generation")) {
    operations.add("audio.generate");
  }
  if (capabilities.includes("video_generation")) {
    operations.add("video.generate");
  }

  return {
    endpointType: "chat_completions" as const,
    pollType: "chat" as const,
    operations: Array.from(
      operations.size > 0 ? operations : ["text.generate"]
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    .orderBy(
      aiPricingRule.toolKey,
      aiPricingRule.featureKey,
      aiPricingRule.modelScope
    );
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
      ...(input.fixedCredits !== undefined
        ? { fixedCredits: input.fixedCredits }
        : {}),
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
  const latestAttemptMap = new Map<string, (typeof attempts)[number]>();

  for (const attempt of attempts) {
    const current = latestAttemptMap.get(attempt.requestId);
    if (!current || attempt.attemptNo > current.attemptNo) {
      latestAttemptMap.set(attempt.requestId, attempt);
    }
  }

  return requests.map((item) => ({
    ...item,
    providerKey:
      (item.winningAttemptNo === null
        ? latestAttemptMap.get(item.requestId)
        : winningAttemptMap.get(`${item.requestId}:${item.winningAttemptNo}`)
      )?.providerKey ?? null,
    providerModel:
      (item.winningAttemptNo === null
        ? latestAttemptMap.get(item.requestId)
        : winningAttemptMap.get(`${item.requestId}:${item.winningAttemptNo}`)
      )?.modelAlias ?? null,
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
      await chatCompletionWithUsage([{ role: "user", content: "reply ok" }], {
        temperature: 0,
        maxTokens: 16,
        aiConfig: {
          provider: "openai",
          apiKey: decryptRelayApiKey(provider.apiKeyEncrypted),
          baseUrl: provider.baseUrl,
          model: binding.modelAlias,
        },
      });

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
export async function createAIBillingAdjustment(
  params: BillingAdjustmentParams
) {
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
          item.totalAttempts === 0
            ? 0
            : item.failedAttempts / item.totalAttempts;
        return (
          item.lastHealthStatus === "down" ||
          failureRate >= failureRateThreshold
        );
      })
      .map((item) => ({
        providerKey: item.key,
        healthStatus: item.lastHealthStatus,
        failureRate:
          item.totalAttempts === 0
            ? 0
            : item.failedAttempts / item.totalAttempts,
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
