import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { GET as getRedinkModelOptions } from "@/app/api/platform/redink/model-options/route";
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
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser, generateTestId } from "../utils";

const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdBindingIds: string[] = [];
const createdRequestIds: string[] = [];
const projectKey = generateTestId("redink_phase2");

afterAll(async () => {
  for (const requestId of createdRequestIds) {
    await db.delete(aiRequestLog).where(eq(aiRequestLog.requestId, requestId));
  }

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
 * 模拟 RedInk 用户登录态。
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
 * 准备模型目录测试所需绑定。
 */
async function seedRelayBinding(modelKey: string, capabilities: string[]) {
  const providerId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  createdProviderIds.push(providerId);
  createdBindingIds.push(bindingId);

  await db.insert(aiRelayProvider).values({
    id: providerId,
    key: `${modelKey}-phase2-provider`,
    name: `${modelKey} Provider`,
    baseUrl: "https://mock.redink-phase2.test/v1",
    apiKeyEncrypted: encryptRelayApiKey("redink-phase2-key"),
    enabled: true,
    priority: 1,
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
    priority: 1,
    weight: 100,
    costMode: "manual",
    inputCostPer1k: 100,
    outputCostPer1k: 200,
    timeoutMs: 30000,
  });
}

describe("RedInk Phase 2 proxy API", () => {
  it("model-options 接口应返回缓存标识并支持 304", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminUser = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phase2-admin-${testSuffix}@qq.com`,
      name: "RedInk Phase2 管理员",
    });
    const normalUser = await createTestUser({
      email: `1183989659+redink-phase2-user-${testSuffix}@qq.com`,
      name: "RedInk Phase2 用户",
    });
    createdUserIds.push(adminUser.id, normalUser.id);

    await seedDefaultToolConfigProject({ projectKey });
    await seedRelayBinding("gpt-4o-mini", ["text"]);

    await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: adminUser.id,
      values: {
        json1: ["gpt-4o-mini"],
        json4: {
          text_generation: {
            defaultModel: "gpt-4o-mini",
            options: [
              {
                modelKey: "gpt-4o-mini",
                label: "标准文案模型",
                description: "适合标题和正文",
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

    mockSession({
      id: normalUser.id,
      name: normalUser.name,
      email: normalUser.email,
    });

    const firstResponse = await getRedinkModelOptions(
      new Request(
        `http://localhost:3000/api/platform/redink/model-options?projectKey=${projectKey}`
      )
    );
    const firstBody = await firstResponse.json();
    const etag = firstResponse.headers.get("etag");

    expect(firstResponse.status).toBe(200);
    expect(firstBody.success).toBe(true);
    expect(firstBody.text_generation.defaultModel).toBe("gpt-4o-mini");
    expect(etag).toContain(`redink-model-options-${projectKey}`);

    const secondResponse = await getRedinkModelOptions(
      new Request(
        `http://localhost:3000/api/platform/redink/model-options?projectKey=${projectKey}`,
        {
          headers: {
            "if-none-match": etag || "",
          },
        }
      )
    );

    expect(secondResponse.status).toBe(304);
    expect(secondResponse.headers.get("etag")).toBe(etag);
  }, 120_000);

  it("request-result 接口应只返回当前用户的 redink 请求", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await createTestUser({
      email: `1183989659+redink-phase2-result-${testSuffix}@qq.com`,
      name: "RedInk Phase2 结果用户",
    });
    createdUserIds.push(user.id);

    const requestId = generateTestId("redink_phase2_request");
    createdRequestIds.push(requestId);

    await db.insert(aiRequestLog).values({
      id: crypto.randomUUID(),
      requestId,
      userId: user.id,
      toolKey: "redink",
      featureKey: "outline",
      requestType: "chat",
      requestedModel: "gpt-4o-mini",
      resolvedModel: "gpt-4o-mini",
      routeStrategy: "primary_only",
      status: "success",
      billingMode: "fixed_credits",
      promptTokens: 120,
      completionTokens: 80,
      totalTokens: 200,
      chargedCredits: 3,
      attemptCount: 1,
      winningAttemptNo: 1,
      responseMeta: {
        providerKey: "geek-default",
        providerModel: "gpt-4o-mini",
        status: "completed",
        output: {
          text: "这是 RedInk 代理返回的标题结果",
        },
      },
    });

    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    const response = await getRedinkRequestResult(
      new Request(
        `http://localhost:3000/api/platform/redink/request-result?requestId=${requestId}`
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.requestId).toBe(requestId);
    expect(data.content).toBe("这是 RedInk 代理返回的标题结果");

    const missingResponse = await getRedinkRequestResult(
      new Request(
        "http://localhost:3000/api/platform/redink/request-result?requestId=not-redink-request"
      )
    );
    const missingData = await missingResponse.json();

    expect(missingResponse.status).toBe(404);
    expect(missingData.error).toBe("request_not_found");
  }, 120_000);
});
