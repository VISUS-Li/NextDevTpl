import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
  toolConfigValue,
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
    await db.delete(aiRelayModelBinding).where(eq(aiRelayModelBinding.id, bindingId));
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

  let [provider] = await db
    .select()
    .from(aiRelayProvider)
    .where(eq(aiRelayProvider.key, "geek-default"))
    .limit(1);

  if (!provider) {
    throw new Error("缺少 geek-default provider，请先完成 Geek provider 配置");
  }

  if (!provider) {
    throw new Error("默认 AI provider 创建失败");
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
    enabled: true,
    priority: 10,
    weight: 100,
    costMode: "manual",
    inputCostPer1k: 150,
    outputCostPer1k: 600,
    timeoutMs: 30000,
  });
}

describe("Platform AI Chat RedInk Defaults", () => {
  it("应自动补齐 redink 的默认 feature 配置和计费规则", async () => {
    await ensureDefaultRelayBinding();
    process.env.OPENAI_API_KEY ??= "test";
    const { POST: postAIChat } = await import("@/app/api/platform/ai/chat/route");

    await db
      .delete(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, "redink"),
          eq(aiPricingRule.featureKey, "outline"),
          eq(aiPricingRule.modelScope, "any")
        )
      );

    await db
      .delete(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, "redink"),
          eq(aiPricingRule.featureKey, "image-generation"),
          eq(aiPricingRule.modelScope, "any")
        )
      );

    const creditsUser = await createTestUserWithCredits({
      email: `1183989659+redink-defaults-${Date.now()}@qq.com`,
      name: "RedInk 默认配置测试用户",
      initialCredits: 20,
    });
    createdUserIds.push(creditsUser.user.id);
    mockSession({
      id: creditsUser.user.id,
      name: creditsUser.user.name,
      email: creditsUser.user.email,
    });

    const outlineResponse = await postAIChat(
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
              content: "请为这篇笔记生成大纲",
            },
          ],
        }),
      })
    );
    const outlineData = await outlineResponse.json();
    expect(outlineData.error).not.toBe("pricing_rule_missing");
    expect(outlineResponse.status).not.toBe(500);

    const imageResponse = await postAIChat(
      new Request("http://localhost:3000/api/platform/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "redink",
          feature: "image-generation",
          messages: [
            {
              role: "user",
              content: "生成一张露营风格的封面图",
            },
          ],
          modalities: ["image"],
          image: {
            aspect_ratio: "3:4",
          },
        }),
      })
    );
    const imageData = await imageResponse.json();
    expect(imageData.error).not.toBe("pricing_rule_missing");
    expect(imageResponse.status).not.toBe(500);

    const [outlineRule] = await db
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
    const [imageRule] = await db
      .select()
      .from(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, "redink"),
          eq(aiPricingRule.featureKey, "image-generation"),
          eq(aiPricingRule.modelScope, "any")
        )
      )
      .limit(1);
    const [featureConfig] = await db
      .select()
      .from(toolConfigValue)
      .where(
        and(
          eq(toolConfigValue.toolKey, "redink"),
          eq(toolConfigValue.fieldKey, "json2"),
          eq(toolConfigValue.scope, "project_admin")
        )
      )
      .limit(1);

    expect(outlineRule?.billingMode).toBe("token_based");
    expect(outlineRule?.minimumCredits).toBe(2);
    expect(imageRule?.billingMode).toBe("fixed_credits");
    expect(imageRule?.fixedCredits).toBe(8);
    expect(featureConfig?.valueJson).toMatchObject({
      outline: {
        enabled: true,
      },
      "image-generation": {
        enabled: true,
      },
    });
  });
});
