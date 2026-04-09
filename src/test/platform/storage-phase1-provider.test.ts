/**
 * 存储统一接入阶段一测试
 *
 * 验证对象存储 provider 配置和 AI 资产公网 URL 转换。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { POST as postPresignedImage } from "@/app/api/platform/storage/presigned-image/route";
import { db } from "@/db";
import {
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
} from "@/db/schema";
import { encryptRelayApiKey } from "@/features/ai-gateway";
import {
  saveUserToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUserWithCredits } from "../utils";

const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdBindingIds: string[] = [];
const createdRuleIds: string[] = [];
const storagePhase1ProviderKey = "geek-storage-phase1";
const storagePhase1FeatureKey = "storage-phase1-image";

const { chatCompletionWithUsageMock } = vi.hoisted(() => ({
  chatCompletionWithUsageMock: vi.fn(),
}));

vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return {
    ...actual,
    chatCompletionWithUsage: chatCompletionWithUsageMock,
  };
});

afterAll(async () => {
  for (const ruleId of createdRuleIds) {
    await db.delete(aiPricingRule).where(eq(aiPricingRule.id, ruleId));
  }

  for (const bindingId of createdBindingIds) {
    await db
      .delete(aiRelayModelBinding)
      .where(eq(aiRelayModelBinding.id, bindingId));
  }

  for (const providerId of createdProviderIds) {
    await db.delete(aiRelayProvider).where(eq(aiRelayProvider.id, providerId));
  }

  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

beforeEach(() => {
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_AI_URL_MODE = "public";
  process.env.NEXT_PUBLIC_APP_URL = "https://platform.tripai.icu";
  process.env.STORAGE_PUBLIC_BASE_URL = "https://assets.tripai.icu";
  chatCompletionWithUsageMock.mockReset();
});

/**
 * 模拟登录会话。
 */
function mockSession(user: { id: string; name: string; email: string }) {
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

/**
 * 初始化 AI 网关基础数据。
 */
async function seedAIBaseData() {
  await seedDefaultToolConfigProject();

  if (createdProviderIds.length === 0) {
    const providerId = crypto.randomUUID();
    createdProviderIds.push(providerId);

    await db.insert(aiRelayProvider).values({
      id: providerId,
      key: storagePhase1ProviderKey,
      name: "Storage Phase1 Geek",
      baseUrl: "https://mock.geek.test/v1",
      apiKeyEncrypted: encryptRelayApiKey("geek-storage-phase1-key"),
      enabled: true,
      priority: 1,
      weight: 100,
      requestType: "chat",
    });
  }

  if (createdBindingIds.length === 0) {
    const providerId = createdProviderIds[0];
    if (!providerId) {
      throw new Error("缺少阶段一 provider");
    }
    const bindingId = crypto.randomUUID();
    createdBindingIds.push(bindingId);

    await db.insert(aiRelayModelBinding).values({
      id: bindingId,
      providerId,
      modelKey: "gpt-4o-mini",
      modelAlias: "gpt-4o-mini",
      enabled: true,
      priority: 1,
      weight: 100,
      costMode: "manual",
      inputCostPer1k: 150,
      outputCostPer1k: 600,
      timeoutMs: 30000,
    });
  }

  if (createdRuleIds.length === 0) {
    const ruleId = crypto.randomUUID();
    createdRuleIds.push(ruleId);

    await db.insert(aiPricingRule).values({
      id: ruleId,
      toolKey: "redink",
      featureKey: storagePhase1FeatureKey,
      requestType: "chat",
      billingMode: "fixed_credits",
      modelScope: "any",
      fixedCredits: 3,
      minimumCredits: 3,
      enabled: true,
    });
  }
}

/**
 * 初始化工具运行时配置。
 */
async function seedToolConfig(actorId: string) {
  await saveUserToolConfig({
    toolKey: "redink",
    actorId,
    values: {
      config1: "gpt-4o-mini",
      config2: "primary_only",
      config3: storagePhase1ProviderKey,
      json1: ["gpt-4o-mini"],
      json2: {
        [storagePhase1FeatureKey]: {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
      },
      json3: [storagePhase1ProviderKey],
    },
  });
}

describe("Storage Phase 1 Provider API", () => {
  it("presigned-image 接口应返回统一公网地址", async () => {
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+storage-image-${Date.now()}@qq.com`,
      name: "存储阶段一上传用户",
      initialCredits: 10,
    });
    createdUserIds.push(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const response = await postPresignedImage(
      new Request("http://localhost:3000/api/platform/storage/presigned-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: "product.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.uploadUrl).toContain("https://platform.tripai.icu");
    expect(data.publicUrl).toContain("https://assets.tripai.icu");
    expect(data.publicUrl).toContain("/api/platform/storage/local-object");
  });

  it("AI Chat 应把资产转成公网 URL 而不是 localhost", async () => {
    await seedAIBaseData();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+storage-ai-${Date.now()}@qq.com`,
      name: "存储阶段一 AI 用户",
      initialCredits: 20,
    });
    createdUserIds.push(creditsUser.user.id);
    await seedToolConfig(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "图片分析完成",
      model: "gpt-4o-mini",
      responseId: "resp_storage_phase1",
      status: "completed",
      output: {
        text: "图片分析完成",
      },
      task: null,
      usage: {
        promptTokens: 120,
        completionTokens: 40,
        totalTokens: 160,
        imageInputTokens: 96,
      },
      raw: {
        id: "resp_storage_phase1",
        model: "gpt-4o-mini",
      },
    });

    const response = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          feature: storagePhase1FeatureKey,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请分析这张商品图",
                },
                {
                  type: "image_asset",
                  bucket: "nextdevtpl-uploads",
                  key: `redink/product-images/${creditsUser.user.id}/demo.png`,
                  detail: "high",
                },
              ],
            },
          ],
        }),
      })
    );
    const data = await response.json();
    const providerMessages =
      chatCompletionWithUsageMock.mock.calls[0]?.[0] as Array<{
        content: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        >;
      }>;
    const imagePart = providerMessages?.[0]?.content?.find(
      (item) => item.type === "image_url"
    ) as { type: "image_url"; image_url: { url: string } } | undefined;

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(imagePart?.image_url.url).toContain("https://assets.tripai.icu");
    expect(imagePart?.image_url.url).not.toContain("http://localhost:3000");
  });
});
