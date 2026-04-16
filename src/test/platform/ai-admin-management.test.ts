/**
 * AI 管理接口测试
 *
 * 模拟管理员通过管理接口维护 Provider、Binding 和 Pricing Rule，
 * 再由普通用户发起 AI 请求，最后管理员读取请求明细。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { GET as getAIRequests } from "@/app/api/platform/ai/admin/requests/route";
import { POST as postModelBinding } from "@/app/api/platform/ai/admin/model-bindings/route";
import { PATCH as patchProvider } from "@/app/api/platform/ai/admin/providers/[id]/route";
import {
  GET as getProviders,
  POST as postProvider,
} from "@/app/api/platform/ai/admin/providers/route";
import { POST as postPricingRule } from "@/app/api/platform/ai/admin/pricing-rules/route";
import { db } from "@/db";
import {
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
} from "@/db/schema";
import { saveUserToolConfig, seedDefaultToolConfigProject } from "@/features/tool-config";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  createTestUserWithCredits,
} from "../utils";

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
  chatCompletionWithUsageMock.mockReset();
});

/**
 * 模拟会话。
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

describe("Platform AI Admin Management API", () => {
  it("应支持管理员维护 AI 配置并查询请求明细", async () => {
    await seedDefaultToolConfigProject();

    const adminUser = await createTestUser({
      email: `1183989659+phase4-admin-${Date.now()}@qq.com`,
      name: "AI 管理测试用户",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);

    const normalUser = await createTestUserWithCredits({
      email: `1183989659+phase4-user-${Date.now()}@qq.com`,
      name: "AI 普通测试用户",
      initialCredits: 20,
    });
    createdUserIds.push(normalUser.user.id);

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const providerResponse = await postProvider(
      new Request("http://localhost:3000/api/platform/ai/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `geek-admin-${Date.now()}`,
          name: "Geek Admin",
          baseUrl: "https://geek-admin.mock.test/v1",
          apiKey: "geek-admin-key",
          enabled: true,
          priority: 1,
          weight: 100,
          requestType: "chat",
        }),
      })
    );
    const providerData = await providerResponse.json();
    const providerId = providerData.provider.id as string;
    const providerKey = providerData.provider.key as string;
    createdProviderIds.push(providerId);

    expect(providerResponse.status).toBe(201);
    expect(providerData.success).toBe(true);

    const bindingResponse = await postModelBinding(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/model-bindings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            modelKey: "gpt-4o-mini",
            modelAlias: "gpt-4o-mini",
            capabilities: ["text"],
            enabled: true,
            priority: 1,
            weight: 100,
            costMode: "manual",
            inputCostPer1k: 150,
            outputCostPer1k: 600,
            fixedCostUsd: 0,
            maxRetries: 0,
            timeoutMs: 30000,
          }),
        }
      )
    );
    const bindingData = await bindingResponse.json();
    createdBindingIds.push(bindingData.binding.id);

    expect(bindingResponse.status).toBe(201);
    expect(bindingData.success).toBe(true);

    const pricingResponse = await postPricingRule(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/pricing-rules",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolKey: "redink",
            featureKey: "admin-rewrite",
            requestType: "chat",
            billingMode: "fixed_credits",
            modelScope: "any",
            fixedCredits: 4,
            inputTokensPerCredit: null,
            outputTokensPerCredit: null,
            costUsdPerCredit: null,
            minimumCredits: 4,
            enabled: true,
          }),
        }
      )
    );
    const pricingData = await pricingResponse.json();
    createdRuleIds.push(pricingData.pricingRule.id);

    expect(pricingResponse.status).toBe(201);
    expect(pricingData.success).toBe(true);

    const patchResponse = await patchProvider(
      new Request(
        `http://localhost:3000/api/platform/ai/admin/providers/${providerId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weight: 120,
          }),
        }
      ),
      { params: Promise.resolve({ id: providerId }) }
    );
    const patchData = await patchResponse.json();
    expect(patchResponse.status).toBe(200);
    expect(patchData.provider.weight).toBe(120);

    await saveUserToolConfig({
      toolKey: "redink",
      actorId: normalUser.user.id,
      values: {
        config1: "gpt-4o-mini",
        config2: "primary_only",
        config3: providerKey,
        json1: ["gpt-4o-mini"],
        json2: {
          "admin-rewrite": {
            enabled: true,
            billingMode: "fixed_credits",
            defaultCredits: 4,
            minimumCredits: 4,
          },
        },
        json3: [providerKey],
      },
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "管理后台测试返回",
      model: "gpt-4o-mini",
      responseId: "resp_admin_management",
      usage: {
        promptTokens: 80,
        completionTokens: 60,
        totalTokens: 140,
      },
      raw: {
        id: "resp_admin_management",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 80,
          completion_tokens: 60,
          total_tokens: 140,
        },
      },
    });

    mockSession({
      id: normalUser.user.id,
      name: normalUser.user.name,
      email: normalUser.user.email,
      role: "user",
    });

    const chatResponse = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "redink",
          feature: "admin-rewrite",
          messages: [{ role: "user", content: "请生成一段管理测试文案" }],
        }),
      })
    );
    const chatData = await chatResponse.json();

    expect(chatResponse.status).toBe(200);
    expect(chatData.success).toBe(true);

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const providersResponse = await getProviders(
      new Request("http://localhost:3000/api/platform/ai/admin/providers")
    );
    const providersData = await providersResponse.json();
    expect(providersResponse.status).toBe(200);
    expect(
      providersData.providers.some(
        (item: { id: string; totalAttempts: number }) =>
          item.id === providerId && item.totalAttempts >= 1
      )
    ).toBe(true);

    const requestsResponse = await getAIRequests(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/requests?toolKey=redink"
      )
    );
    const requestsData = await requestsResponse.json();

    expect(requestsResponse.status).toBe(200);
    expect(requestsData.success).toBe(true);
    expect(
      requestsData.requests.some(
        (item: { providerKey: string; featureKey: string; userEmail: string }) =>
          item.providerKey === providerKey &&
          item.featureKey === "admin-rewrite" &&
          item.userEmail === normalUser.user.email
      )
    ).toBe(true);
  });

  it("失败请求也应显示实际尝试过的 provider", async () => {
    await seedDefaultToolConfigProject();

    const adminUser = await createTestUser({
      email: `1183989659+phase4-admin-failed-${Date.now()}@qq.com`,
      name: "AI 管理失败测试用户",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);

    const normalUser = await createTestUserWithCredits({
      email: `1183989659+phase4-user-failed-${Date.now()}@qq.com`,
      name: "AI 普通失败测试用户",
      initialCredits: 20,
    });
    createdUserIds.push(normalUser.user.id);

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const providerResponse = await postProvider(
      new Request("http://localhost:3000/api/platform/ai/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `geek-admin-failed-${Date.now()}`,
          name: "Geek Admin Failed",
          baseUrl: "https://geek-admin-failed.mock.test/v1",
          apiKey: "geek-admin-failed-key",
          enabled: true,
          priority: 1,
          weight: 100,
          requestType: "chat",
        }),
      })
    );
    const providerData = await providerResponse.json();
    const providerId = providerData.provider.id as string;
    const providerKey = providerData.provider.key as string;
    createdProviderIds.push(providerId);

    const bindingResponse = await postModelBinding(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/model-bindings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            modelKey: "gpt-4o-mini",
            modelAlias: "gpt-4o-mini",
            capabilities: ["text"],
            enabled: true,
            priority: 1,
            weight: 100,
            costMode: "manual",
            inputCostPer1k: 150,
            outputCostPer1k: 600,
            fixedCostUsd: 0,
            maxRetries: 0,
            timeoutMs: 30000,
          }),
        }
      )
    );
    const bindingData = await bindingResponse.json();
    createdBindingIds.push(bindingData.binding.id);

    const pricingResponse = await postPricingRule(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/pricing-rules",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolKey: "redink",
            featureKey: "admin-rewrite-failed",
            requestType: "chat",
            billingMode: "fixed_credits",
            modelScope: "any",
            fixedCredits: 4,
            inputTokensPerCredit: null,
            outputTokensPerCredit: null,
            costUsdPerCredit: null,
            minimumCredits: 4,
            enabled: true,
          }),
        }
      )
    );
    const pricingData = await pricingResponse.json();
    createdRuleIds.push(pricingData.pricingRule.id);

    await saveUserToolConfig({
      toolKey: "redink",
      actorId: normalUser.user.id,
      values: {
        config1: "gpt-4o-mini",
        config2: "primary_only",
        config3: providerKey,
        json1: ["gpt-4o-mini"],
        json2: {
          "admin-rewrite-failed": {
            enabled: true,
            billingMode: "fixed_credits",
            defaultCredits: 4,
            minimumCredits: 4,
          },
        },
        json3: [providerKey],
      },
    });

    chatCompletionWithUsageMock.mockRejectedValueOnce(
      new Error("mock upstream failed")
    );

    mockSession({
      id: normalUser.user.id,
      name: normalUser.user.name,
      email: normalUser.user.email,
      role: "user",
    });

    const chatResponse = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "redink",
          feature: "admin-rewrite-failed",
          messages: [{ role: "user", content: "请生成一段会失败的管理测试文案" }],
        }),
      })
    );
    const chatData = await chatResponse.json();

    expect(chatResponse.status).toBe(502);
    expect(chatData.success).toBe(false);

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const requestsResponse = await getAIRequests(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/requests?toolKey=redink&status=failed"
      )
    );
    const requestsData = await requestsResponse.json();

    expect(requestsResponse.status).toBe(200);
    expect(requestsData.success).toBe(true);
    expect(
      requestsData.requests.some(
        (item: { providerKey: string; featureKey: string; userEmail: string }) =>
          item.providerKey === providerKey &&
          item.featureKey === "admin-rewrite-failed" &&
          item.userEmail === normalUser.user.email
      )
    ).toBe(true);
  });
});
