/**
 * AI 网关摘要接口测试
 *
 * 通过真实调用 AI 接口后再读取 summary 接口，
 * 验证运营汇总数据能够正确统计。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAISummary } from "@/app/api/platform/ai/summary/route";
import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { db } from "@/db";
import { aiPricingRule, aiRelayModelBinding, aiRelayProvider } from "@/db/schema";
import { encryptRelayApiKey } from "@/features/ai-gateway";
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
    await db.delete(aiRelayModelBinding).where(eq(aiRelayModelBinding.id, bindingId));
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

async function seedSummaryBaseData(userId: string) {
  await seedDefaultToolConfigProject();

  const providerId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const ruleId = crypto.randomUUID();

  createdProviderIds.push(providerId);
  createdBindingIds.push(bindingId);
  createdRuleIds.push(ruleId);

  await db.insert(aiRelayProvider).values({
    id: providerId,
    key: "geek-summary",
    name: "Geek Summary",
    baseUrl: "https://geek-summary.mock.test/v1",
    apiKeyEncrypted: encryptRelayApiKey("geek-summary-key"),
    enabled: true,
    priority: 1,
    weight: 100,
    requestType: "chat",
  });

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

  await db.insert(aiPricingRule).values({
    id: ruleId,
    toolKey: "redink",
    featureKey: "summary-rewrite",
    requestType: "chat",
    billingMode: "fixed_credits",
    modelScope: "any",
    fixedCredits: 3,
    minimumCredits: 3,
    enabled: true,
  });

  await saveUserToolConfig({
    toolKey: "redink",
    actorId: userId,
    values: {
      config1: "gpt-4o-mini",
      config2: "primary_only",
      config3: "geek-summary",
      json1: ["gpt-4o-mini"],
      json2: {
        rewrite: {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
        "summary-rewrite": {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
      },
      json3: ["geek-summary"],
    },
  });
}

describe("Platform AI Summary API", () => {
  it("应返回 AI 请求总览和 provider 摘要", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+phase5-admin-${Date.now()}@qq.com`,
      name: "AI 管理员测试用户",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);

    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+phase5-user-${Date.now()}@qq.com`,
      name: "AI 普通测试用户",
      initialCredits: 10,
    });
    createdUserIds.push(creditsUser.user.id);

    await seedSummaryBaseData(creditsUser.user.id);

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "summary 测试内容",
      model: "gpt-4o-mini",
      responseId: "resp_summary",
      usage: {
        promptTokens: 100,
        completionTokens: 120,
        totalTokens: 220,
      },
      raw: {
        id: "resp_summary",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 120,
          total_tokens: 220,
        },
      },
    });

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
      role: "user",
    });

    await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          feature: "summary-rewrite",
          messages: [{ role: "user", content: "请生成摘要测试内容" }],
          stream: false,
        }),
      })
    );

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const response = await getAISummary(
      new Request("http://localhost:3000/api/platform/ai/summary")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.overview.totalRequests).toBeGreaterThan(0);
    expect(data.overview.successRequests).toBeGreaterThan(0);
    expect(data.overview.totalChargedCredits).toBeGreaterThan(0);
    expect(
      data.providers.some((item: { providerKey: string }) => item.providerKey === "geek-summary")
    ).toBe(true);
  });
});
