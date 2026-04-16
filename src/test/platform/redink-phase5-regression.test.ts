import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postRedinkImage } from "@/app/api/platform/redink/image/route";
import { GET as getRedinkModelOptions } from "@/app/api/platform/redink/model-options/route";
import { GET as getRedinkRequestResult } from "@/app/api/platform/redink/request-result/route";
import { POST as postRedinkText } from "@/app/api/platform/redink/text/route";
import { db } from "@/db";
import { aiRelayModelBinding, aiRelayProvider, project } from "@/db/schema";
import { encryptRelayApiKey } from "@/features/ai-gateway";
import {
  saveAdminToolConfig,
  saveUserToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  createTestUserWithCredits,
  generateTestId,
} from "../utils";

const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdBindingIds: string[] = [];
const projectKey = generateTestId("redink_phase5");

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
  for (const bindingId of createdBindingIds) {
    await db
      .delete(aiRelayModelBinding)
      .where(eq(aiRelayModelBinding.id, bindingId));
  }

  for (const providerId of createdProviderIds) {
    await db.delete(aiRelayProvider).where(eq(aiRelayProvider.id, providerId));
  }

  await db.delete(project).where(eq(project.key, projectKey));
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
}, 120_000);

beforeEach(() => {
  chatCompletionWithUsageMock.mockReset();
  retrieveChatCompletionWithUsageMock.mockReset();
});

/**
 * 模拟同一用户的完整调用会话。
 */
function mockSession(user: {
  id: string;
  name: string;
  email: string;
  role?: string;
}) {
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
 * 初始化回归测试所需的模型绑定。
 */
async function seedBinding(
  modelKey: string,
  capabilities: string[],
  priority: number
) {
  const providerId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  createdProviderIds.push(providerId);
  createdBindingIds.push(bindingId);

  await db.insert(aiRelayProvider).values({
    id: providerId,
    key: `${modelKey}-phase5-provider`,
    name: `${modelKey} Provider`,
    baseUrl: "https://mock.redink-phase5.test/v1",
    apiKeyEncrypted: encryptRelayApiKey("redink-phase5-key"),
    enabled: true,
    priority,
    weight: 100,
    requestType: "chat",
  });

  await db.insert(aiRelayModelBinding).values({
    id: bindingId,
    providerId,
    modelKey,
    modelAlias: modelKey,
    metadata: { capabilities },
    enabled: true,
    priority,
    weight: 100,
    costMode: "manual",
    inputCostPer1k: 100,
    outputCostPer1k: 200,
    timeoutMs: 30000,
  });
}

describe("RedInk Phase 5 regression API", () => {
  it("应打通目录读取、文本生成、图片任务与轮询结果", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase5-admin-${testSuffix}@qq.com`,
      name: "RedInk Phase5 管理员",
    });
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+redink-phase5-user-${testSuffix}@qq.com`,
      name: "RedInk Phase5 用户",
      initialCredits: 30,
    });
    createdUserIds.push(adminUser.id, creditsUser.user.id);

    await seedDefaultToolConfigProject({ projectKey });
    await seedBinding("deepseek-chat", ["text"], 1);
    await seedBinding("gemini-3-pro-image", ["text", "image_generation"], 2);

    await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: adminUser.id,
      values: {
        json1: ["deepseek-chat", "gemini-3-pro-image"],
        json4: {
          text_generation: {
            defaultModel: "deepseek-chat",
            options: [
              {
                modelKey: "deepseek-chat",
                label: "长文模型",
                description: "适合标题和正文",
              },
            ],
          },
          image_generation: {
            defaultModel: "gemini-3-pro-image",
            options: [
              {
                modelKey: "gemini-3-pro-image",
                label: "发布图模型",
                description: "适合商品发布图",
              },
            ],
          },
        },
      },
    });

    await saveUserToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: creditsUser.user.id,
      values: {
        config1: "deepseek-chat",
        config2: "priority_failover",
        config3: "deepseek-chat-phase5-provider",
        json1: ["deepseek-chat", "gemini-3-pro-image"],
        json3: [
          "deepseek-chat-phase5-provider",
          "gemini-3-pro-image-phase5-provider",
        ],
      },
    });

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const modelOptionsResponse = await getRedinkModelOptions(
      new Request(
        `http://localhost:3000/api/platform/redink/model-options?projectKey=${projectKey}`
      )
    );
    const modelOptionsData = await modelOptionsResponse.json();

    expect(modelOptionsResponse.status).toBe(200);
    expect(modelOptionsData.text_generation.defaultModel).toBe("deepseek-chat");
    expect(modelOptionsData.image_generation.defaultModel).toBe(
      "gemini-3-pro-image"
    );

    chatCompletionWithUsageMock
      .mockResolvedValueOnce({
        content: "轻量便携旅行水杯，通勤露营都好看",
        model: "deepseek-chat",
        responseId: "resp_phase5_text",
        status: "completed",
        output: {
          text: "轻量便携旅行水杯，通勤露营都好看",
        },
        usage: {
          promptTokens: 90,
          completionTokens: 70,
          totalTokens: 160,
        },
        raw: {
          id: "resp_phase5_text",
          model: "deepseek-chat",
        },
      })
      .mockResolvedValueOnce({
        content: "",
        model: "gemini-3-pro-image",
        responseId: "task_phase5_image",
        status: "pending",
        output: {},
        task: {
          id: "task_phase5_image",
          status: "pending",
        },
        usage: {
          promptTokens: 75,
          completionTokens: 0,
          totalTokens: 75,
        },
        raw: {
          id: "task_phase5_image",
          status: "pending",
          model: "gemini-3-pro-image",
        },
      });

    const textResponse = await postRedinkText(
      new Request("http://localhost:3000/api/platform/redink/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "copywriting",
          input: "请生成一段适合旅行水杯的小红书正文",
        }),
      })
    );
    const textData = await textResponse.json();

    expect(textResponse.status).toBe(200);
    expect(textData.success).toBe(true);
    expect(textData.model).toBe("deepseek-chat");

    const imageResponse = await postRedinkImage(
      new Request("http://localhost:3000/api/platform/redink/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "product_post_image",
          input: "请生成一张适合小红书封面的旅行水杯发布图",
          image: {
            aspect_ratio: "3:4",
          },
          background: true,
        }),
      })
    );
    const imageData = await imageResponse.json();

    expect(imageResponse.status).toBe(200);
    expect(imageData.success).toBe(true);
    expect(imageData.status).toBe("pending");
    expect(imageData.model).toBe("gemini-3-pro-image");

    retrieveChatCompletionWithUsageMock.mockResolvedValue({
      content: "图片生成完成",
      model: "gemini-3-pro-image",
      responseId: "task_phase5_image",
      status: "completed",
      output: {
        text: "图片生成完成",
        images: [
          {
            url: "https://img.test/redink-phase5-cover.png",
          },
        ],
      },
      usage: {
        promptTokens: 75,
        completionTokens: 110,
        totalTokens: 185,
      },
      raw: {
        id: "task_phase5_image",
        status: "completed",
        model: "gemini-3-pro-image",
      },
    });

    const resultResponse = await getRedinkRequestResult(
      new Request(
        `http://localhost:3000/api/platform/redink/request-result?requestId=${imageData.requestId}`
      )
    );
    const resultData = await resultResponse.json();

    expect(resultResponse.status).toBe(200);
    expect(resultData.success).toBe(true);
    expect(resultData.status).toBe("completed");
    expect(resultData.output.images?.[0]?.url).toBe(
      "https://img.test/redink-phase5-cover.png"
    );
  }, 120_000);
});
