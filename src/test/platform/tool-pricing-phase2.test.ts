import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAIChat } from "@/app/api/platform/ai/chat/route";
import { db } from "@/db";
import {
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  toolFeature,
} from "@/db/schema";
import { seedDefaultToolConfigProject } from "@/features/tool-config";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUserWithCredits } from "../utils";

const createdUserIds: string[] = [];
const createdBindingIds: string[] = [];

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const bindingId of createdBindingIds) {
    await db
      .delete(aiRelayModelBinding)
      .where(eq(aiRelayModelBinding.id, bindingId));
  }

  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

/**
 * 模拟用户登录态。
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
 * 确保默认 provider 和模型绑定存在。
 */
async function ensureDefaultRelayBinding() {
  await seedDefaultToolConfigProject();

  const [provider] = await db
    .select()
    .from(aiRelayProvider)
    .where(eq(aiRelayProvider.key, "geekai"))
    .limit(1);

  if (!provider) {
    throw new Error("缺少 geekai provider，请先完成 Geek provider 配置");
  }

  const [binding] = await db
    .select()
    .from(aiRelayModelBinding)
    .where(
      and(
        eq(aiRelayModelBinding.providerId, provider.id),
        eq(aiRelayModelBinding.modelKey, "gpt-4o-mini")
      )
    )
    .limit(1);

  if (binding) {
    return;
  }

  const bindingId = crypto.randomUUID();
  createdBindingIds.push(bindingId);
  await db.insert(aiRelayModelBinding).values({
    id: bindingId,
    providerId: provider.id,
    modelKey: "gpt-4o-mini",
    modelAlias: "gpt-4o-mini",
    metadata: {
      capabilities: ["text", "image_generation"],
    },
    enabled: true,
    priority: 10,
    weight: 100,
    costMode: "manual",
    inputCostPer1k: 150,
    outputCostPer1k: 600,
    timeoutMs: 30000,
  });
}

describe("Tool pricing phase 2", () => {
  it("应该按工具定义补齐功能表和默认计费规则，并允许用户走统一 AI 接口调用", async () => {
    await ensureDefaultRelayBinding();
    process.env.OPENAI_API_KEY ??= "test";

    await db
      .delete(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, "redink"),
          eq(aiPricingRule.featureKey, "outline"),
          eq(aiPricingRule.modelScope, "any")
        )
      );

    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+tool-pricing-phase2-${Date.now()}@qq.com`,
      name: "工具计费阶段二测试用户",
      initialCredits: 20,
    });
    createdUserIds.push(creditsUser.user.id);
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
          feature: "outline",
          messages: [
            {
              role: "user",
              content: "请模拟生成一段商品笔记提纲",
            },
          ],
        }),
      })
    );
    const body = await response.json();

    const [featureRow] = await db
      .select()
      .from(toolFeature)
      .where(
        and(
          eq(toolFeature.toolKey, "redink"),
          eq(toolFeature.featureKey, "outline")
        )
      )
      .limit(1);
    const [pricingRule] = await db
      .select()
      .from(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, "redink"),
          eq(aiPricingRule.featureKey, "outline"),
          eq(aiPricingRule.modelScope, "any")
        )
      )
      .limit(1);

    expect(response.status).not.toBe(500);
    expect(body.error).not.toBe("pricing_rule_missing");
    expect(featureRow).toMatchObject({
      toolKey: "redink",
      featureKey: "outline",
      requestType: "chat",
      defaultOperation: "text.generate",
    });
    expect(pricingRule).toMatchObject({
      toolKey: "redink",
      featureKey: "outline",
      billingMode: "token_based",
      minimumCredits: 2,
      inputTokensPerCredit: 600,
      outputTokensPerCredit: 300,
    });
  }, 60000);
});
