import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { GET as getRedinkModelOptions } from "@/app/api/platform/redink/model-options/route";
import { db } from "@/db";
import { aiRelayModelBinding, aiRelayProvider, project } from "@/db/schema";
import { encryptRelayApiKey } from "@/features/ai-gateway";
import {
  saveAdminToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser, generateTestId } from "../utils";

const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdBindingIds: string[] = [];
const projectKey = generateTestId("redink_model_catalog");

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

/**
 * 模拟已登录会话。
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
 * 准备测试所需的 AI 模型绑定。
 */
async function seedRelayBinding(
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
    key: `${modelKey}-provider-${priority}`,
    name: `${modelKey} Provider`,
    baseUrl: "https://mock.redink-model.test/v1",
    apiKeyEncrypted: encryptRelayApiKey("redink-model-key"),
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

describe("RedInk model options API", () => {
  it("应只返回管理员配置且通过能力校验的用户可见模型子集", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminUser = await createTestUser({
      // 使用 QQ 邮箱前缀模拟真实测试用户，避免共享测试库邮箱冲突。
      role: "admin",
      email: `1183989659+redink-model-admin-${testSuffix}@qq.com`,
      name: "RedInk 模型管理员",
    });
    const normalUser = await createTestUser({
      // 这里保留用户提供的账号前缀，接口测试仍然模拟同一来源用户。
      email: `1183989659+redink-model-user-${testSuffix}@qq.com`,
      name: "RedInk 模型测试用户",
    });
    createdUserIds.push(adminUser.id, normalUser.id);

    await seedDefaultToolConfigProject({ projectKey });
    await seedRelayBinding("gpt-4o-mini", ["text"], 1);
    await seedRelayBinding(
      "gemini-3-pro-image",
      ["text", "image_input", "image_generation"],
      2
    );

    await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: adminUser.id,
      values: {
        json1: ["gpt-4o-mini", "gemini-3-pro-image", "ghost-model"],
        json4: {
          text_generation: {
            defaultModel: "gpt-4o-mini",
            options: [
              {
                modelKey: "gpt-4o-mini",
                label: "标题文案标准模型",
                description: "适合标题和文案",
              },
              {
                modelKey: "ghost-model",
                label: "无效模型",
                description: "没有绑定不应该返回",
              },
            ],
          },
          image_generation: {
            defaultModel: "gemini-3-pro-image",
            options: [
              {
                modelKey: "gemini-3-pro-image",
                label: "商品发布图模型",
                description: "适合发布图出图",
              },
              {
                modelKey: "gpt-4o-mini",
                label: "错误图片模型",
                description: "没有出图能力不应该返回",
              },
            ],
          },
        },
      },
    });

    mockSession({
      id: normalUser.id,
      name: normalUser.name,
      email: normalUser.email,
      role: "user",
    });

    const response = await getRedinkModelOptions(
      new Request(
        `http://localhost:3000/api/platform/redink/model-options?projectKey=${projectKey}`
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.text_generation).toEqual({
      defaultModel: "gpt-4o-mini",
      options: [
        {
          modelKey: "gpt-4o-mini",
          label: "标题文案标准模型",
          description: "适合标题和文案",
        },
      ],
    });
    expect(data.image_generation).toEqual({
      defaultModel: "gemini-3-pro-image",
      options: [
        {
          modelKey: "gemini-3-pro-image",
          label: "商品发布图模型",
          description: "适合发布图出图",
        },
      ],
    });
  }, 120_000);

  it("未登录时应拒绝读取模型目录", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValue(null as never);

    const response = await getRedinkModelOptions(
      new Request("http://localhost:3000/api/platform/redink/model-options")
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe("unauthorized");
  }, 120_000);
});
