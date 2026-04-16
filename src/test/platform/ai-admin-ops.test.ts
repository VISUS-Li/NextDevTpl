/**
 * AI 运维接口测试
 *
 * 模拟管理员执行健康检查、手工调账和告警查询，
 * 验证运维动作不会破坏账本和 Provider 状态。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { GET as getAlerts } from "@/app/api/platform/ai/admin/alerts/route";
import { POST as postBillingAdjustment } from "@/app/api/platform/ai/admin/billing-adjustments/route";
import { POST as postHealthCheck } from "@/app/api/platform/ai/admin/providers/health-check/route";
import { POST as postModelBinding } from "@/app/api/platform/ai/admin/model-bindings/route";
import { POST as postProvider } from "@/app/api/platform/ai/admin/providers/route";
import { POST as postPricingRule } from "@/app/api/platform/ai/admin/pricing-rules/route";
import { db } from "@/db";
import {
  aiBillingRecord,
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
  getUserCreditsState,
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

describe("Platform AI Admin Ops API", () => {
  it("应支持手工调账、健康检查下线和告警查询", async () => {
    await seedDefaultToolConfigProject();

    const adminUser = await createTestUser({
      email: `1183989659+phase5-admin-${Date.now()}@qq.com`,
      name: "AI 运维管理员",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);

    const normalUser = await createTestUserWithCredits({
      email: `1183989659+phase5-user-${Date.now()}@qq.com`,
      name: "AI 运维普通用户",
      initialCredits: 12,
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
          key: `yunwu-ops-${Date.now()}`,
          name: "Yunwu Ops",
          baseUrl: "https://yunwu-ops.mock.test/v1",
          apiKey: "yunwu-ops-key",
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
            featureKey: "ops-rewrite",
            requestType: "chat",
            billingMode: "fixed_credits",
            modelScope: "any",
            fixedCredits: 5,
            inputTokensPerCredit: null,
            outputTokensPerCredit: null,
            costUsdPerCredit: null,
            minimumCredits: 5,
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
          "ops-rewrite": {
            enabled: true,
            billingMode: "fixed_credits",
            defaultCredits: 5,
            minimumCredits: 5,
          },
        },
        json3: [providerKey],
      },
    });

    chatCompletionWithUsageMock.mockResolvedValueOnce({
      content: "运维测试返回",
      model: "gpt-4o-mini",
      responseId: "resp_admin_ops",
      usage: {
        promptTokens: 200,
        completionTokens: 120,
        totalTokens: 320,
      },
      raw: {
        id: "resp_admin_ops",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 200,
          completion_tokens: 120,
          total_tokens: 320,
        },
      },
    });

    mockSession({
      id: normalUser.user.id,
      name: normalUser.user.name,
      email: normalUser.user.email,
      role: "user",
    });

    const beforeChatCredits = await getUserCreditsState(normalUser.user.id);
    const chatResponse = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "redink",
          feature: "ops-rewrite",
          messages: [{ role: "user", content: "请生成一段运维测试文案" }],
        }),
      })
    );
    const chatData = await chatResponse.json();
    const afterChatCredits = await getUserCreditsState(normalUser.user.id);

    expect(chatResponse.status).toBe(200);
    expect(afterChatCredits.balance?.balance).toBe(
      (beforeChatCredits.balance?.balance ?? 0) - 5
    );

    mockSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: "admin",
    });

    const refundResponse = await postBillingAdjustment(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/billing-adjustments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: chatData.requestId,
            direction: "refund",
            credits: 2,
            reason: "人工核账退款",
          }),
        }
      )
    );
    const refundData = await refundResponse.json();
    const afterRefundCredits = await getUserCreditsState(normalUser.user.id);

    expect(refundResponse.status).toBe(201);
    expect(refundData.record.status).toBe("reversed");
    expect(refundData.record.chargedCredits).toBe(-2);
    expect(afterRefundCredits.balance?.balance).toBe(
      (afterChatCredits.balance?.balance ?? 0) + 2
    );

    const [reversedRecord] = await db
      .select()
      .from(aiBillingRecord)
      .where(eq(aiBillingRecord.id, refundData.record.id))
      .limit(1);
    expect(reversedRecord?.status).toBe("reversed");

    chatCompletionWithUsageMock.mockRejectedValueOnce(new Error("health check failed"));

    const healthCheckResponse = await postHealthCheck(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/providers/health-check",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerIds: [providerId],
            disableOnFailure: true,
          }),
        }
      )
    );
    const healthCheckData = await healthCheckResponse.json();

    expect(healthCheckResponse.status).toBe(200);
    expect(healthCheckData.results[0].ok).toBe(false);
    expect(healthCheckData.results[0].status).toBe("down");

    const [updatedProvider] = await db
      .select()
      .from(aiRelayProvider)
      .where(eq(aiRelayProvider.id, providerId))
      .limit(1);
    expect(updatedProvider?.enabled).toBe(false);
    expect(updatedProvider?.lastHealthStatus).toBe("down");

    const alertsResponse = await getAlerts(
      new Request(
        "http://localhost:3000/api/platform/ai/admin/alerts?costAlertMicros=1"
      )
    );
    const alertsData = await alertsResponse.json();

    expect(alertsResponse.status).toBe(200);
    expect(alertsData.success).toBe(true);
    expect(
      alertsData.alerts.providers.some(
        (item: { providerKey: string; healthStatus: string }) =>
          item.providerKey === providerKey && item.healthStatus === "down"
      )
    ).toBe(true);
    expect(
      alertsData.alerts.highCostRequests.some(
        (item: { requestId: string }) => item.requestId === chatData.requestId
      )
    ).toBe(true);
  });
});
