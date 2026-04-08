/**
 * 平台 AI Chat 接口测试
 *
 * 模拟工具以普通用户身份调用平台 AI 接口，
 * 验证请求日志、积分扣费和错误响应是否正确。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { saveAdminToolConfig, seedDefaultToolConfigProject } from "@/features/tool-config";
import { auth } from "@/lib/auth";
import {
  aiBillingRecord,
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  aiRequestAttempt,
  aiRequestLog,
  creditsTransaction,
} from "@/db/schema";
import { encryptRelayApiKey } from "@/features/ai-gateway";
import { db } from "@/db";
import {
  cleanupTestUsers,
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
 * 初始化 AI 网关测试基础数据。
 */
async function seedAIGatewayBaseData() {
  await seedDefaultToolConfigProject();

  if (createdProviderIds.length === 0) {
    const providerId = crypto.randomUUID();
    createdProviderIds.push(providerId);

    await db.insert(aiRelayProvider).values({
      id: providerId,
      key: "geek-default",
      name: "Geek Default",
      baseUrl: "https://mock.geek.test/v1",
      apiKeyEncrypted: encryptRelayApiKey("geek-test-key"),
      enabled: true,
      priority: 1,
      weight: 100,
      requestType: "chat",
    });
  }

  if (createdBindingIds.length === 0) {
    const bindingId = crypto.randomUUID();
    createdBindingIds.push(bindingId);

    await db.insert(aiRelayModelBinding).values({
      id: bindingId,
      providerId: createdProviderIds[0]!,
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
      featureKey: "rewrite",
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
 * 新增一条计费规则。
 */
async function insertPricingRule(
  values: Partial<typeof aiPricingRule.$inferInsert> & {
    toolKey: string;
    featureKey: string;
    billingMode: "fixed_credits" | "token_based" | "cost_plus";
  }
) {
  const ruleId = crypto.randomUUID();
  createdRuleIds.push(ruleId);

  await db.insert(aiPricingRule).values({
    id: ruleId,
    requestType: "chat",
    modelScope: "any",
    minimumCredits: 0,
    enabled: true,
    ...values,
  });
}

/**
 * 新增一个额外 provider，供回退场景测试。
 */
async function insertFallbackProvider(providerKey: string, priority: number) {
  const providerId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  createdProviderIds.push(providerId);
  createdBindingIds.push(bindingId);

  await db.insert(aiRelayProvider).values({
    id: providerId,
    key: providerKey,
    name: providerKey,
    baseUrl: `https://${providerKey}.mock.test/v1`,
    apiKeyEncrypted: encryptRelayApiKey(`${providerKey}-key`),
    enabled: true,
    priority,
    weight: 100,
    requestType: "chat",
  });

  await db.insert(aiRelayModelBinding).values({
    id: bindingId,
    providerId,
    modelKey: "gpt-4o-mini",
    modelAlias: "gpt-4o-mini",
    enabled: true,
    priority,
    weight: 100,
    costMode: "manual",
    inputCostPer1k: 150,
    outputCostPer1k: 600,
    timeoutMs: 30000,
  });
}

/**
 * 初始化工具配置。
 */
async function seedToolConfig(actorId: string) {
  await saveAdminToolConfig({
    toolKey: "redink",
    actorId,
    values: {
      config1: "gpt-4o-mini",
      config2: "primary_only",
      config3: "geek-default",
      json1: ["gpt-4o-mini"],
      json2: {
        rewrite: {
          enabled: true,
          billingMode: "fixed_credits",
          defaultCredits: 3,
          minimumCredits: 3,
        },
      },
      json3: ["geek-default"],
    },
  });
}

describe("Platform AI Chat API", () => {
  it("应完成 AI 调用、写入请求日志并扣减积分", async () => {
    await seedAIGatewayBaseData();
    const testEmail = `1183989659+phase1-success-${Date.now()}@qq.com`;
    const creditsUser = await createTestUserWithCredits({
      email: testEmail,
      name: "AI 测试用户",
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
      content: "改写后的内容",
      model: "gpt-4o-mini",
      responseId: "resp_123",
      usage: {
        promptTokens: 120,
        completionTokens: 80,
        totalTokens: 200,
      },
      raw: {
        id: "resp_123",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 120,
          completion_tokens: 80,
          total_tokens: 200,
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
          feature: "rewrite",
          messages: [{ role: "user", content: "请帮我改写这段文案" }],
          stream: false,
          metadata: {
            source: "redink-editor",
          },
        }),
      })
    );
    const data = await response.json();

    const [requestLog] = await db
      .select()
      .from(aiRequestLog)
      .where(eq(aiRequestLog.requestId, data.requestId))
      .limit(1);
    const transactions = await db
      .select()
      .from(creditsTransaction)
      .where(eq(creditsTransaction.userId, creditsUser.user.id));

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.provider).toBe("geek-default");
    expect(data.billing.chargedCredits).toBe(3);
    expect(data.billing.remainingBalance).toBe(7);
    expect(requestLog?.status).toBe("success");
    expect(requestLog?.chargedCredits).toBe(3);
    expect(requestLog?.totalTokens).toBe(200);
    expect(
      transactions.some(
        (item) =>
          item.type === "consumption" &&
          item.creditAccount === "SERVICE:ai:redink:rewrite"
      )
    ).toBe(true);
  });

  it("余额不足时应返回 insufficient_credits，且不调用上游", async () => {
    await seedAIGatewayBaseData();
    const testEmail = `1183989659+phase1-low-${Date.now()}@qq.com`;
    const creditsUser = await createTestUserWithCredits({
      email: testEmail,
      name: "AI 测试用户余额不足",
      initialCredits: 1,
    });
    createdUserIds.push(creditsUser.user.id);
    await seedToolConfig(creditsUser.user.id);

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const response = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          feature: "rewrite",
          messages: [{ role: "user", content: "请帮我改写这段文案" }],
          stream: false,
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error).toBe("insufficient_credits");
    expect(chatCompletionWithUsageMock).not.toHaveBeenCalled();
  });

  it("主中转站失败时应自动回退到下一个 provider", async () => {
    await seedAIGatewayBaseData();
    await insertFallbackProvider("yunwu-backup", 2);

    const testEmail = `1183989659+phase2-fallback-${Date.now()}@qq.com`;
    const creditsUser = await createTestUserWithCredits({
      email: testEmail,
      name: "AI 回退测试用户",
      initialCredits: 10,
    });
    createdUserIds.push(creditsUser.user.id);

    await saveAdminToolConfig({
      toolKey: "redink",
      actorId: creditsUser.user.id,
      values: {
        config1: "gpt-4o-mini",
        config2: "priority_failover",
        config3: "geek-default",
        json1: ["gpt-4o-mini"],
        json2: {
          rewrite: {
            enabled: true,
            billingMode: "fixed_credits",
            defaultCredits: 3,
            minimumCredits: 3,
          },
        },
        json3: ["geek-default", "yunwu-backup"],
      },
    });

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock
      .mockRejectedValueOnce(new Error("primary provider unavailable"))
      .mockResolvedValueOnce({
        content: "回退成功后的内容",
        model: "gpt-4o-mini",
        responseId: "resp_fallback",
        usage: {
          promptTokens: 50,
          completionTokens: 60,
          totalTokens: 110,
        },
        raw: {
          id: "resp_fallback",
          model: "gpt-4o-mini",
          usage: {
            prompt_tokens: 50,
            completion_tokens: 60,
            total_tokens: 110,
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
          feature: "rewrite",
          messages: [{ role: "user", content: "请帮我再次改写这段文案" }],
          stream: false,
        }),
      })
    );
    const data = await response.json();

    const [requestLog] = await db
      .select()
      .from(aiRequestLog)
      .where(eq(aiRequestLog.requestId, data.requestId))
      .limit(1);
    const attempts = await db
      .select()
      .from(aiRequestAttempt)
      .where(eq(aiRequestAttempt.requestId, data.requestId));

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.provider).toBe("yunwu-backup");
    expect(requestLog?.attemptCount).toBe(2);
    expect(requestLog?.winningAttemptNo).toBe(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.providerKey).toBe("geek-default");
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[1]?.providerKey).toBe("yunwu-backup");
    expect(attempts[1]?.status).toBe("success");
    expect(chatCompletionWithUsageMock).toHaveBeenCalledTimes(2);
  });

  it("token_based 规则应按 usage 扣费，并写入 billing record", async () => {
    await seedAIGatewayBaseData();
    await insertPricingRule({
      toolKey: "redink",
      featureKey: "analysis",
      billingMode: "token_based",
      inputTokensPerCredit: 100,
      outputTokensPerCredit: 80,
      minimumCredits: 2,
    });

    const testEmail = `1183989659+phase3-token-${Date.now()}@qq.com`;
    const creditsUser = await createTestUserWithCredits({
      email: testEmail,
      name: "AI Token 计费测试用户",
      initialCredits: 20,
    });
    createdUserIds.push(creditsUser.user.id);

    await saveAdminToolConfig({
      toolKey: "redink",
      actorId: creditsUser.user.id,
      values: {
        config1: "gpt-4o-mini",
        config2: "primary_only",
        config3: "geek-default",
        json1: ["gpt-4o-mini"],
        json2: {
          analysis: {
            enabled: true,
            billingMode: "token_based",
            minimumCredits: 2,
          },
        },
        json3: ["geek-default"],
      },
    });

    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    chatCompletionWithUsageMock.mockResolvedValue({
      content: "分析完成",
      model: "gpt-4o-mini",
      responseId: "resp_token",
      usage: {
        promptTokens: 250,
        completionTokens: 160,
        totalTokens: 410,
      },
      raw: {
        id: "resp_token",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 250,
          completion_tokens: 160,
          total_tokens: 410,
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
          feature: "analysis",
          messages: [{ role: "user", content: "请分析这段长文本" }],
          stream: false,
        }),
      })
    );
    const data = await response.json();

    const [requestLog] = await db
      .select()
      .from(aiRequestLog)
      .where(eq(aiRequestLog.requestId, data.requestId))
      .limit(1);
    const [billingRecord] = await db
      .select()
      .from(aiBillingRecord)
      .where(eq(aiBillingRecord.requestId, data.requestId))
      .limit(1);
    const transactions = await db
      .select()
      .from(creditsTransaction)
      .where(eq(creditsTransaction.userId, creditsUser.user.id));

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.billing.billingMode).toBe("token_based");
    expect(data.billing.chargedCredits).toBe(5);
    expect(data.billing.remainingBalance).toBe(15);
    expect(requestLog?.providerCostUsd).toBe(134);
    expect(requestLog?.chargedCredits).toBe(5);
    expect(billingRecord?.status).toBe("charged");
    expect(billingRecord?.chargedCredits).toBe(5);
    expect(
      transactions.some(
        (item) =>
          item.type === "consumption" &&
          item.amount === 5 &&
          item.creditAccount === "SERVICE:ai:redink:analysis"
      )
    ).toBe(true);
  });
});
