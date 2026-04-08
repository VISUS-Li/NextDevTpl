/**
 * 阶段三多模态 AI Chat 接口测试
 *
 * 模拟工具用户创建任务型多模态请求，再通过平台轮询接口获取最终结果，
 * 验证 pending -> completed 的平台状态流转与扣费时机。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAIChatResult } from "@/app/api/platform/ai/chat/result/route";
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
const phase3ProviderKey = "geek-phase3";
const phase3FeatureKey = "rewrite-mm-phase3";

const { chatCompletionWithUsageMock, retrieveChatCompletionWithUsageMock } =
  vi.hoisted(() => ({
    chatCompletionWithUsageMock: vi.fn(),
    retrieveChatCompletionWithUsageMock: vi.fn(),
  }));

vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return {
    ...actual,
    chatCompletionWithUsage: chatCompletionWithUsageMock,
    retrieveChatCompletionWithUsage: retrieveChatCompletionWithUsageMock,
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
  retrieveChatCompletionWithUsageMock.mockReset();
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
 * 初始化阶段三测试基础数据。
 */
async function seedPhase3Data() {
  await seedDefaultToolConfigProject();

  if (createdProviderIds.length === 0) {
    const providerId = crypto.randomUUID();
    createdProviderIds.push(providerId);

    await db.insert(aiRelayProvider).values({
      id: providerId,
      key: phase3ProviderKey,
      name: "Geek Phase3",
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
      throw new Error("缺少阶段三测试 provider");
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
      featureKey: phase3FeatureKey,
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
      config3: phase3ProviderKey,
      json1: ["gpt-4o-mini"],
      json2: {
        [phase3FeatureKey]: {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
      },
      json3: [phase3ProviderKey],
    },
  });
}

describe("Platform AI Chat API Phase 3", () => {
  it("应支持视频资产输入、任务挂起与轮询完成", async () => {
    await seedPhase3Data();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+mm-phase3-video-${Date.now()}@qq.com`,
      name: "多模态阶段三视频用户",
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
      content: "",
      model: "gpt-4o-mini",
      responseId: "task_video_001",
      status: "pending",
      output: {},
      task: {
        id: "task_video_001",
        status: "pending",
      },
      usage: {
        promptTokens: 90,
        completionTokens: 0,
        totalTokens: 90,
        videoInputTokens: 64,
      },
      raw: {
        id: "task_video_001",
        status: "pending",
        model: "gpt-4o-mini",
      },
    });

    const createResponse = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          feature: phase3FeatureKey,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请分析视频并生成一张概念图",
                },
                {
                  type: "video_asset",
                  bucket: "nextdevtpl-uploads",
                  key: `redink/video/${creditsUser.user.id}/sample.mp4`,
                },
              ],
            },
          ],
          modalities: ["image"],
          image: {
            aspect_ratio: "1:1",
          },
          background: true,
        }),
      })
    );
    const createData = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createData.success).toBe(true);
    expect(createData.status).toBe("pending");
    expect(createData.task.id).toBe("task_video_001");
    expect(createData.billing.chargedCredits).toBe(0);
    expect(chatCompletionWithUsageMock.mock.calls[0]?.[0]).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请分析视频并生成一张概念图",
          },
          {
            type: "video_url",
            video_url: {
              url: `http://localhost:3000/api/platform/storage/local-object?bucket=nextdevtpl-uploads&key=${encodeURIComponent(`redink/video/${creditsUser.user.id}/sample.mp4`)}`,
            },
          },
        ],
      },
    ]);

    retrieveChatCompletionWithUsageMock.mockResolvedValue({
      content: "图像已生成",
      model: "gpt-4o-mini",
      responseId: "task_video_001",
      status: "completed",
      output: {
        text: "图像已生成",
        image: "https://example.com/generated-image.png",
      },
      task: null,
      usage: {
        promptTokens: 90,
        completionTokens: 40,
        totalTokens: 130,
        videoInputTokens: 64,
      },
      raw: {
        id: "task_video_001",
        status: "completed",
      },
    });

    const pollResponse = await getAIChatResult(
      new Request(
        `http://localhost:3000/api/platform/ai/chat/result?requestId=${createData.requestId}`,
        {
          method: "GET",
        }
      )
    );
    const pollData = await pollResponse.json();

    const [requestLog] = await db
      .select()
      .from(aiRequestLog)
      .where(eq(aiRequestLog.requestId, createData.requestId))
      .limit(1);

    expect(pollResponse.status).toBe(200);
    expect(pollData.success).toBe(true);
    expect(pollData.status).toBe("completed");
    expect(pollData.output.image).toBe(
      "https://example.com/generated-image.png"
    );
    expect(pollData.billing.chargedCredits).toBe(3);
    expect(requestLog?.status).toBe("success");
    expect(retrieveChatCompletionWithUsageMock).toHaveBeenCalledTimes(1);
  });

  it("应支持视频任务输出轮询完成", async () => {
    await seedPhase3Data();
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+mm-phase3-output-${Date.now()}@qq.com`,
      name: "多模态阶段三视频输出用户",
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
      content: "",
      model: "gpt-4o-mini",
      responseId: "task_video_output_001",
      status: "pending",
      output: {},
      task: {
        id: "task_video_output_001",
        status: "pending",
      },
      usage: {
        promptTokens: 70,
        completionTokens: 0,
        totalTokens: 70,
      },
      raw: {
        id: "task_video_output_001",
        status: "pending",
      },
    });

    const createResponse = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          feature: phase3FeatureKey,
          input: "请生成一段 5 秒钟的视频脚本并产出视频",
          modalities: ["video"],
          background: true,
        }),
      })
    );
    const createData = await createResponse.json();

    retrieveChatCompletionWithUsageMock.mockResolvedValue({
      content: "视频已生成",
      model: "gpt-4o-mini",
      responseId: "task_video_output_001",
      status: "completed",
      output: {
        text: "视频已生成",
        video: "https://example.com/generated-video.mp4",
      },
      task: null,
      usage: {
        promptTokens: 70,
        completionTokens: 50,
        totalTokens: 120,
      },
      raw: {
        id: "task_video_output_001",
        status: "completed",
      },
    });

    const pollResponse = await getAIChatResult(
      new Request(
        `http://localhost:3000/api/platform/ai/chat/result?requestId=${createData.requestId}`,
        {
          method: "GET",
        }
      )
    );
    const pollData = await pollResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createData.status).toBe("pending");
    expect(pollResponse.status).toBe(200);
    expect(pollData.output.video).toBe(
      "https://example.com/generated-video.mp4"
    );
    expect(pollData.billing.chargedCredits).toBe(3);
  });
});
