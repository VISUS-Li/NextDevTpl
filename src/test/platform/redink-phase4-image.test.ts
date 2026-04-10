import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postRedinkImage } from "@/app/api/platform/redink/image/route";
import { GET as getRedinkRequestResult } from "@/app/api/platform/redink/request-result/route";
import { db } from "@/db";
import {
  aiRelayModelBinding,
  aiRelayProvider,
  aiRequestLog,
  project,
} from "@/db/schema";
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
const projectKey = generateTestId("redink_phase4");
let seededPhase4Base = false;

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
 * 模拟图片代理用户会话。
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
 * 初始化基础模型绑定。
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
    key: `${modelKey}-phase4-provider`,
    name: `${modelKey} Provider`,
    baseUrl: "https://mock.redink-phase4.test/v1",
    apiKeyEncrypted: encryptRelayApiKey("redink-phase4-key"),
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

/**
 * 初始化管理员目录和用户白名单。
 */
async function seedImageCatalog(adminId: string, userId: string) {
  if (seededPhase4Base) {
    await saveUserToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: userId,
      values: {
        config1: "gpt-4o-mini",
        config2: "priority_failover",
        config3: "gemini-3-pro-image-phase4-provider",
        json1: ["gpt-4o-mini", "gemini-3-pro-image"],
        json3: [
          "gpt-4o-mini-phase4-provider",
          "gemini-3-pro-image-phase4-provider",
        ],
      },
    });
    return;
  }

  await seedDefaultToolConfigProject({ projectKey });
  await seedBinding("gpt-4o-mini", ["text"], 1);
  await seedBinding("gemini-3-pro-image", ["text", "image_generation"], 2);

  await saveAdminToolConfig({
    projectKey,
    toolKey: "redink",
    actorId: adminId,
    values: {
      json1: ["gpt-4o-mini", "gemini-3-pro-image"],
      json4: {
        text_generation: {
          defaultModel: "gpt-4o-mini",
          options: [
            {
              modelKey: "gpt-4o-mini",
              label: "标准文案模型",
              description: "适合标题与正文",
            },
          ],
        },
        image_generation: {
          defaultModel: "gemini-3-pro-image",
          options: [
            {
              modelKey: "gemini-3-pro-image",
              label: "商品发布图模型",
              description: "适合发布图与主图生成",
            },
          ],
        },
      },
    },
  });

  await saveUserToolConfig({
    projectKey,
    toolKey: "redink",
    actorId: userId,
    values: {
      config1: "gpt-4o-mini",
      config2: "priority_failover",
      config3: "gemini-3-pro-image-phase4-provider",
      json1: ["gpt-4o-mini", "gemini-3-pro-image"],
      json3: [
        "gpt-4o-mini-phase4-provider",
        "gemini-3-pro-image-phase4-provider",
      ],
    },
  });
  seededPhase4Base = true;
}

describe("RedInk Phase 4 image API", () => {
  it("应支持商品发布图任务创建并通过代理轮询完成", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase4-admin-${testSuffix}@qq.com`,
      name: "RedInk Phase4 管理员",
    });
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+redink-phase4-user-${testSuffix}@qq.com`,
      name: "RedInk Phase4 用户",
      initialCredits: 20,
    });
    createdUserIds.push(adminUser.id, creditsUser.user.id);
    await seedImageCatalog(adminUser.id, creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "",
      model: "gemini-3-pro-image",
      responseId: "task_phase4_image",
      status: "pending",
      output: {},
      task: {
        id: "task_phase4_image",
        status: "pending",
      },
      usage: {
        promptTokens: 80,
        completionTokens: 0,
        totalTokens: 80,
      },
      raw: {
        id: "task_phase4_image",
        status: "pending",
        model: "gemini-3-pro-image",
      },
    });

    const createResponse = await postRedinkImage(
      new Request("http://localhost:3000/api/platform/redink/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "product_post_image",
          model: "gemini-3-pro-image",
          input: "请生成一张旅行水杯商品发布图",
          image: {
            aspect_ratio: "3:4",
          },
          background: true,
        }),
      })
    );
    const createData = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createData.success).toBe(true);
    expect(createData.status).toBe("pending");
    expect(createData.model).toBe("gemini-3-pro-image");
    expect(createData.requestId).toBeTruthy();
    expect(
      chatCompletionWithUsageMock.mock.calls[0]?.[1]?.aiConfig?.model
    ).toBe("gemini-3-pro-image");

    retrieveChatCompletionWithUsageMock.mockResolvedValue({
      content: "已生成商品发布图",
      model: "gemini-3-pro-image",
      responseId: "task_phase4_image",
      status: "completed",
      output: {
        text: "已生成商品发布图",
        images: [
          {
            url: "https://img.test/redink-phase4-product.png",
          },
        ],
      },
      usage: {
        promptTokens: 80,
        completionTokens: 120,
        totalTokens: 200,
      },
      raw: {
        id: "task_phase4_image",
        status: "completed",
        model: "gemini-3-pro-image",
      },
    });

    const pollResponse = await getRedinkRequestResult(
      new Request(
        `http://localhost:3000/api/platform/redink/request-result?requestId=${createData.requestId}`
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
    expect(pollData.output.images?.[0]?.url).toBe(
      "https://img.test/redink-phase4-product.png"
    );
    expect(requestLog?.featureKey).toBe("product-post-image");
  }, 120_000);

  it("未传模型时应回落到图片目录默认模型", async () => {
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase4-admin-default-${Date.now()}@qq.com`,
      name: "RedInk Phase4 默认管理员",
    });
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+redink-phase4-default-${Date.now()}@qq.com`,
      name: "RedInk Phase4 默认模型用户",
      initialCredits: 20,
    });
    createdUserIds.push(adminUser.id, creditsUser.user.id);
    await seedImageCatalog(adminUser.id, creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "已生成通用图片",
      model: "gemini-3-pro-image",
      responseId: "resp_phase4_default",
      status: "completed",
      output: {
        text: "已生成通用图片",
        images: [
          {
            url: "https://img.test/redink-phase4-general.png",
          },
        ],
      },
      usage: {
        promptTokens: 70,
        completionTokens: 90,
        totalTokens: 160,
      },
      raw: {
        id: "resp_phase4_default",
        model: "gemini-3-pro-image",
      },
    });

    const response = await postRedinkImage(
      new Request("http://localhost:3000/api/platform/redink/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "general_image",
          input: "请生成一张适合首页 banner 的旅行海报",
          image: {
            aspect_ratio: "16:9",
          },
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.model).toBe("gemini-3-pro-image");
    expect(
      chatCompletionWithUsageMock.mock.calls.at(-1)?.[1]?.aiConfig?.model
    ).toBe("gemini-3-pro-image");
  }, 120_000);

  it("请求未开放的图片模型时应拒绝", async () => {
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase4-admin-deny-${Date.now()}@qq.com`,
      name: "RedInk Phase4 拒绝管理员",
    });
    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+redink-phase4-deny-${Date.now()}@qq.com`,
      name: "RedInk Phase4 拒绝用户",
      initialCredits: 20,
    });
    createdUserIds.push(adminUser.id, creditsUser.user.id);
    await seedImageCatalog(adminUser.id, creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const response = await postRedinkImage(
      new Request("http://localhost:3000/api/platform/redink/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "general_image",
          model: "gpt-4o-mini",
          input: "请生成一张旅行海报",
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toBe("model_not_allowed");
    expect(chatCompletionWithUsageMock).not.toHaveBeenCalled();
  }, 120_000);
});
