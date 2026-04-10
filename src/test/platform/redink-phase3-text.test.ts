import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postRedinkText } from "@/app/api/platform/redink/text/route";
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
const projectKey = generateTestId("redink_phase3");
let seededPhase3Base = false;

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
});

/**
 * 模拟文本代理用户会话。
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
 * 初始化文本模型绑定。
 */
async function seedTextBinding(modelKey: string, priority: number) {
  const providerId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  createdProviderIds.push(providerId);
  createdBindingIds.push(bindingId);

  await db.insert(aiRelayProvider).values({
    id: providerId,
    key: `${modelKey}-phase3-provider`,
    name: `${modelKey} Provider`,
    baseUrl: "https://mock.redink-phase3.test/v1",
    apiKeyEncrypted: encryptRelayApiKey("redink-phase3-key"),
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
    metadata: { capabilities: ["text"] },
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
async function seedTextCatalog(adminId: string, userId: string) {
  if (seededPhase3Base) {
    await saveUserToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: userId,
      values: {
        config1: "gpt-4o-mini",
        config2: "priority_failover",
        config3: "gpt-4o-mini-phase3-provider",
        json1: ["gpt-4o-mini", "deepseek-chat"],
        json3: ["gpt-4o-mini-phase3-provider", "deepseek-chat-phase3-provider"],
      },
    });
    return;
  }

  await seedDefaultToolConfigProject({ projectKey });
  await seedTextBinding("gpt-4o-mini", 1);
  await seedTextBinding("deepseek-chat", 2);

  await saveAdminToolConfig({
    projectKey,
    toolKey: "redink",
    actorId: adminId,
    values: {
      json1: ["gpt-4o-mini", "deepseek-chat"],
      json4: {
        text_generation: {
          defaultModel: "gpt-4o-mini",
          options: [
            {
              modelKey: "gpt-4o-mini",
              label: "标准文案模型",
              description: "适合标题与正文",
            },
            {
              modelKey: "deepseek-chat",
              label: "长文模型",
              description: "适合商品发布文案",
            },
          ],
        },
        image_generation: {
          defaultModel: null,
          options: [],
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
      config3: "gpt-4o-mini-phase3-provider",
      json1: ["gpt-4o-mini", "deepseek-chat"],
      json3: ["gpt-4o-mini-phase3-provider", "deepseek-chat-phase3-provider"],
    },
  });
  seededPhase3Base = true;
}

describe("RedInk Phase 3 text API", () => {
  it("应按用户选择的模型执行标题生成", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase3-admin-${testSuffix}@qq.com`,
      name: "RedInk Phase3 管理员",
    });
    const normalUser = await createTestUserWithCredits({
      email: `1183989659+redink-phase3-user-${testSuffix}@qq.com`,
      name: "RedInk Phase3 用户",
      initialCredits: 20,
    });
    createdUserIds.push(adminUser.id, normalUser.user.id);
    await seedTextCatalog(adminUser.id, normalUser.user.id);

    mockSession({
      id: normalUser.user.id,
      name: normalUser.user.name,
      email: normalUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "标题一\n标题二",
      model: "deepseek-chat",
      responseId: "resp_phase3_title",
      usage: {
        promptTokens: 90,
        completionTokens: 60,
        totalTokens: 150,
      },
      raw: {
        id: "resp_phase3_title",
        model: "deepseek-chat",
      },
    });

    const response = await postRedinkText(
      new Request("http://localhost:3000/api/platform/redink/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "title",
          model: "deepseek-chat",
          input: "请给这款旅行水杯生成两个小红书标题",
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
    expect(data.scene).toBe("title");
    expect(data.model).toBe("deepseek-chat");
    expect(requestLog?.featureKey).toBe("outline");
    expect(requestLog?.requestedModel).toBe("deepseek-chat");
    expect(
      chatCompletionWithUsageMock.mock.calls[0]?.[1]?.aiConfig?.model
    ).toBe("deepseek-chat");
  }, 120_000);

  it("未传模型时应回落到管理员目录默认模型", async () => {
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase3-admin-default-${Date.now()}@qq.com`,
      name: "RedInk Phase3 默认管理员",
    });
    const user = await createTestUserWithCredits({
      email: `1183989659+redink-phase3-default-${Date.now()}@qq.com`,
      name: "RedInk Phase3 默认模型用户",
      initialCredits: 20,
    });
    createdUserIds.push(adminUser.id, user.user.id);
    await seedTextCatalog(adminUser.id, user.user.id);

    mockSession({
      id: user.user.id,
      name: user.user.name,
      email: user.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "这是一段商品发布文案",
      model: "gpt-4o-mini",
      responseId: "resp_phase3_default",
      usage: {
        promptTokens: 120,
        completionTokens: 100,
        totalTokens: 220,
      },
      raw: {
        id: "resp_phase3_default",
        model: "gpt-4o-mini",
      },
    });

    const response = await postRedinkText(
      new Request("http://localhost:3000/api/platform/redink/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "product_post_content",
          input: "请生成完整的商品发布文案",
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.model).toBe("gpt-4o-mini");
    expect(
      chatCompletionWithUsageMock.mock.calls.at(-1)?.[1]?.aiConfig?.model
    ).toBe("gpt-4o-mini");
  }, 120_000);

  it("请求未开放的文本模型时应拒绝", async () => {
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase3-admin-deny-${Date.now()}@qq.com`,
      name: "RedInk Phase3 拒绝管理员",
    });
    const user = await createTestUserWithCredits({
      email: `1183989659+redink-phase3-deny-${Date.now()}@qq.com`,
      name: "RedInk Phase3 拒绝用户",
      initialCredits: 20,
    });
    createdUserIds.push(adminUser.id, user.user.id);
    await seedTextCatalog(adminUser.id, user.user.id);

    mockSession({
      id: user.user.id,
      name: user.user.name,
      email: user.user.email,
    });

    const response = await postRedinkText(
      new Request("http://localhost:3000/api/platform/redink/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          scene: "copywriting",
          model: "gemini-3-pro-image",
          input: "请生成一段商品文案",
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
