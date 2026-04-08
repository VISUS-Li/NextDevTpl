/**
 * 阶段一多模态 AI Chat 接口测试
 *
 * 模拟工具用户通过平台统一接口发送文本和图片输入，
 * 验证平台能正确归一化消息并继续完成结算。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { db } from "@/db";
import {
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  aiRequestLog,
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
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
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
 * 初始化阶段一测试所需的 AI 基础数据。
 */
async function seedPhase1Data() {
  await seedDefaultToolConfigProject();

  if (createdProviderIds.length === 0) {
    const providerId = crypto.randomUUID();
    createdProviderIds.push(providerId);

    await db.insert(aiRelayProvider).values({
      id: providerId,
      key: "geek-default",
      name: "Geek Default",
      baseUrl: "https://mock.geek.test/v1",
      apiKeyEncrypted: encryptRelayApiKey("geek-test-key"),
      enabled: true,
      priority: 1,
      weight: 100,
      requestType: "chat",
    });
  }

  if (createdBindingIds.length === 0) {
    const providerId = createdProviderIds[0];
    if (!providerId) {
      throw new Error("缺少阶段一测试 provider");
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
      featureKey: "rewrite",
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
 * 初始化工具配置。
 */
async function seedToolConfig(actorId: string) {
  await saveUserToolConfig({
    toolKey: "redink",
    actorId,
    values: {
      config1: "gpt-4o-mini",
      config2: "primary_only",
      config3: "geek-default",
      json1: ["gpt-4o-mini"],
      json2: {
        rewrite: {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
      },
      json3: ["geek-default"],
    },
  });
}

describe("Platform AI Chat API Phase 1", () => {
  it("应支持文本加图片 URL 输入", async () => {
    await seedPhase1Data();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+mm-phase1-url-${Date.now()}@qq.com`,
      name: "多模态阶段一 URL 用户",
      initialCredits: 10,
    });
    createdUserIds.push(creditsUser.user.id);
    await seedToolConfig(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "我看到了你上传的商品图",
      model: "gpt-4o-mini",
      responseId: "resp_mm_phase1_url",
      status: "completed",
      output: {
        text: "我看到了你上传的商品图",
      },
      task: null,
      usage: {
        promptTokens: 180,
        completionTokens: 60,
        totalTokens: 240,
        imageInputTokens: 96,
      },
      raw: {
        id: "resp_mm_phase1_url",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 180,
          completion_tokens: 60,
          total_tokens: 240,
          prompt_tokens_details: {
            image_tokens: 96,
          },
        },
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
          feature: "rewrite",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请根据图片改写商品介绍",
                },
                {
                  type: "image_url",
                  imageUrl: "https://example.com/mock-product.png",
                  detail: "high",
                },
              ],
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.output.text).toBe("我看到了你上传的商品图");
    expect(data.usage.imageInputTokens).toBe(96);
    expect(chatCompletionWithUsageMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionWithUsageMock.mock.calls[0]?.[0]).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请根据图片改写商品介绍",
          },
          {
            type: "image_url",
            image_url: {
              url: "https://example.com/mock-product.png",
              detail: "high",
            },
          },
        ],
      },
    ]);
  });

  it("应支持平台图片资产输入并转成受控 URL", async () => {
    await seedPhase1Data();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+mm-phase1-asset-${Date.now()}@qq.com`,
      name: "多模态阶段一资产用户",
      initialCredits: 10,
    });
    createdUserIds.push(creditsUser.user.id);
    await seedToolConfig(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "已读取平台存储中的图片",
      model: "gpt-4o-mini",
      responseId: "resp_mm_phase1_asset",
      status: "completed",
      output: {
        text: "已读取平台存储中的图片",
      },
      task: null,
      usage: {
        promptTokens: 150,
        completionTokens: 50,
        totalTokens: 200,
      },
      raw: {
        id: "resp_mm_phase1_asset",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 150,
          completion_tokens: 50,
          total_tokens: 200,
        },
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
          feature: "rewrite",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请描述这张平台图片",
                },
                {
                  type: "image_asset",
                  bucket: "nextdevtpl-uploads",
                  key: `redink/product-images/${creditsUser.user.id}/test.png`,
                },
              ],
            },
          ],
        }),
      })
    );
    const data = await response.json();

    const [requestLog] = await db
      .select()
      .from(aiRequestLog)
      .where(eq(aiRequestLog.requestId, data.requestId))
      .limit(1);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.output.text).toBe("已读取平台存储中的图片");
    expect(requestLog?.status).toBe("success");
    expect(chatCompletionWithUsageMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionWithUsageMock.mock.calls[0]?.[0]).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请描述这张平台图片",
          },
          {
            type: "image_url",
            image_url: {
              url: `http://localhost:3000/api/platform/storage/local-object?bucket=nextdevtpl-uploads&key=${encodeURIComponent(`redink/product-images/${creditsUser.user.id}/test.png`)}`,
            },
          },
        ],
      },
    ]);
  });
});
