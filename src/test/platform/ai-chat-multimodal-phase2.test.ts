/**
 * 阶段二多模态 AI Chat 接口测试
 *
 * 模拟工具用户通过平台统一接口发送文本和音频输入，
 * 验证音频输出、usage 明细与 responses 风格 input 兼容链路。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
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
const phase2ProviderKey = "geek-phase2";
const phase2FeatureKey = "rewrite-mm-phase2";

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
 * 初始化工具配置。
 */
async function seedToolConfig(actorId: string) {
  await saveUserToolConfig({
    toolKey: "redink",
    actorId,
    values: {
      config1: "gpt-4o-mini",
      config2: "primary_only",
      config3: phase2ProviderKey,
      json1: ["gpt-4o-mini"],
      json2: {
        [phase2FeatureKey]: {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
      },
      json3: [phase2ProviderKey],
    },
  });
}

/**
 * 初始化阶段二测试所需的 AI 基础数据。
 */
async function seedPhase2Data() {
  await seedDefaultToolConfigProject();

  if (createdProviderIds.length === 0) {
    const providerId = crypto.randomUUID();
    createdProviderIds.push(providerId);

    await db.insert(aiRelayProvider).values({
      id: providerId,
      key: phase2ProviderKey,
      name: "Geek Phase2",
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
      throw new Error("缺少阶段二测试 provider");
    }
    const bindingId = crypto.randomUUID();
    createdBindingIds.push(bindingId);

    await db.insert(aiRelayModelBinding).values({
      id: bindingId,
      providerId,
      modelKey: "gpt-4o-mini",
      modelAlias: "gpt-4o-mini",
      metadata: {
        capabilities: ["text", "audio_input", "audio_generation"],
      },
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
      featureKey: phase2FeatureKey,
      requestType: "chat",
      billingMode: "fixed_credits",
      modelScope: "any",
      fixedCredits: 3,
      minimumCredits: 3,
      enabled: true,
    });
  }
}

describe("Platform AI Chat API Phase 2", () => {
  it("应支持 audio_asset 输入与音频输出", async () => {
    await seedPhase2Data();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+mm-phase2-audio-${Date.now()}@qq.com`,
      name: "多模态阶段二音频用户",
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
      content: "这是音频转写后的文本",
      model: "gpt-4o-mini",
      responseId: "resp_mm_phase2_audio",
      status: "completed",
      output: {
        text: "这是音频转写后的文本",
        audio: {
          id: "audio_001",
          data: "base64-audio-data",
          expiresAt: 1_800_000_000,
          transcript: "这是音频转写后的文本",
        },
      },
      task: null,
      usage: {
        promptTokens: 220,
        completionTokens: 70,
        totalTokens: 290,
        audioInputTokens: 128,
        reasoningTokens: 32,
      },
      raw: {
        id: "resp_mm_phase2_audio",
        model: "gpt-4o-mini",
        choices: [
          {
            message: {
              role: "assistant",
              content: "这是音频转写后的文本",
              audio: {
                id: "audio_001",
                data: "base64-audio-data",
                expires_at: 1_800_000_000,
                transcript: "这是音频转写后的文本",
              },
            },
          },
        ],
        usage: {
          prompt_tokens: 220,
          completion_tokens: 70,
          total_tokens: 290,
          prompt_tokens_details: {
            audio_tokens: 128,
          },
          completion_tokens_details: {
            reasoning_tokens: 32,
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
          feature: phase2FeatureKey,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请听取这段录音并整理成文本",
                },
                {
                  type: "audio_asset",
                  bucket: "nextdevtpl-uploads",
                  key: `redink/audio/${creditsUser.user.id}/sample.wav`,
                  format: "wav",
                },
              ],
            },
          ],
          modalities: ["text", "audio"],
          audio: {
            voice: "alloy",
            format: "wav",
          },
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.output.audio.id).toBe("audio_001");
    expect(data.output.audio.transcript).toBe("这是音频转写后的文本");
    expect(data.usage.audioInputTokens).toBe(128);
    expect(data.usage.reasoningTokens).toBe(32);
    expect(chatCompletionWithUsageMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionWithUsageMock.mock.calls[0]?.[0]).toMatchObject([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请听取这段录音并整理成文本",
          },
          {
            type: "audio_url",
            audio_url: {
              url: expect.stringContaining(
                encodeURIComponent(`redink/audio/${creditsUser.user.id}/sample.wav`)
              ),
              format: "wav",
            },
          },
        ],
      },
    ]);
    expect(chatCompletionWithUsageMock.mock.calls[0]?.[1]).toMatchObject({
      extraBody: {
        modalities: ["text", "audio"],
        audio: {
          voice: "alloy",
          format: "wav",
        },
      },
    });
  });

  it("应支持 responses 风格的 input 字符串输入", async () => {
    await seedPhase2Data();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+mm-phase2-input-${Date.now()}@qq.com`,
      name: "多模态阶段二 input 用户",
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
      content: "已按 input 文本生成回复",
      model: "gpt-4o-mini",
      responseId: "resp_mm_phase2_input",
      usage: {
        promptTokens: 60,
        completionTokens: 30,
        totalTokens: 90,
      },
      raw: {
        id: "resp_mm_phase2_input",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 60,
          completion_tokens: 30,
          total_tokens: 90,
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
          feature: phase2FeatureKey,
          input: "请把这段话读成自然语气并给出文字版",
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.output.text).toBe("已按 input 文本生成回复");
    expect(chatCompletionWithUsageMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionWithUsageMock.mock.calls[0]?.[0]).toEqual([
      {
        role: "user",
        content: "请把这段话读成自然语气并给出文字版",
      },
    ]);
  });
});
