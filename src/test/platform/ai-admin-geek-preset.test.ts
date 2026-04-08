/**
 * Geek 预设配置接口测试
 *
 * 验证管理员可一键创建或更新 Geek provider、模型绑定和计费规则。
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postGeekPreset } from "@/app/api/platform/ai/admin/presets/geek/route";
import { db } from "@/db";
import {
  aiPricingRule,
  aiRelayModelBinding,
  aiRelayProvider,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { cleanupTestUsers, createTestUser } from "../utils";

const createdUserIds: string[] = [];

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db
    .delete(aiPricingRule)
    .where(eq(aiPricingRule.featureKey, "geek-preset-rewrite"));
  await db
    .delete(aiRelayModelBinding)
    .where(eq(aiRelayModelBinding.modelKey, "gpt-5-mini"));
  await db
    .delete(aiRelayProvider)
    .where(eq(aiRelayProvider.key, "geek-preset-test"));
  await cleanupTestUsers(createdUserIds);
});

/**
 * 模拟管理员会话。
 */
function mockAdminSession(user: { id: string; name: string; email: string }) {
  vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: {
      id: `session_${user.id}`,
      token: `token_${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      ...user,
      role: "admin",
    },
  } as never);
}

describe("Platform AI Admin Geek Preset API", () => {
  it("应支持创建并重复更新 Geek 预设配置", async () => {
    const adminUser = await createTestUser({
      email: `1183989659+geek-preset-${Date.now()}@qq.com`,
      name: "Geek 预设管理员",
      role: "admin",
    });
    createdUserIds.push(adminUser.id);

    mockAdminSession({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
    });

    const firstResponse = await postGeekPreset(
      new Request("http://localhost:3000/api/platform/ai/admin/presets/geek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: "geek-api-key-1",
          providerKey: "geek-preset-test",
          providerName: "Geek Preset Test",
          models: [
            {
              modelKey: "gpt-5-mini",
              modelAlias: "gpt-5-mini",
              tier: "standard",
            },
          ],
          pricingRules: [
            {
              toolKey: "redink",
              featureKey: "geek-preset-rewrite",
              profile: "multimodal_basic",
            },
          ],
        }),
      })
    );
    const firstData = await firstResponse.json();

    expect(firstResponse.status).toBe(201);
    expect(firstData.success).toBe(true);
    expect(firstData.provider.key).toBe("geek-preset-test");
    expect(firstData.bindings).toHaveLength(1);
    expect(firstData.pricingRules).toHaveLength(1);
    expect(firstData.bindings[0].inputCostPer1k).toBe(500);
    expect(firstData.pricingRules[0].billingMode).toBe("token_based");
    expect(firstData.pricingRules[0].minimumCredits).toBe(3);

    const secondResponse = await postGeekPreset(
      new Request("http://localhost:3000/api/platform/ai/admin/presets/geek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: "geek-api-key-2",
          providerKey: "geek-preset-test",
          providerName: "Geek Preset Test",
          models: [
            {
              modelKey: "gpt-5-mini",
              modelAlias: "gpt-5-mini",
              tier: "premium",
              timeoutMs: 55000,
            },
          ],
          pricingRules: [
            {
              toolKey: "redink",
              featureKey: "geek-preset-rewrite",
              profile: "async_media",
            },
          ],
        }),
      })
    );
    const secondData = await secondResponse.json();

    const [provider] = await db
      .select()
      .from(aiRelayProvider)
      .where(eq(aiRelayProvider.key, "geek-preset-test"))
      .limit(1);
    const [binding] = await db
      .select()
      .from(aiRelayModelBinding)
      .where(eq(aiRelayModelBinding.modelKey, "gpt-5-mini"))
      .limit(1);
    const [pricingRule] = await db
      .select()
      .from(aiPricingRule)
      .where(eq(aiPricingRule.featureKey, "geek-preset-rewrite"))
      .limit(1);

    expect(secondResponse.status).toBe(201);
    expect(secondData.success).toBe(true);
    expect(provider?.key).toBe("geek-preset-test");
    expect(binding?.inputCostPer1k).toBe(1500);
    expect(binding?.timeoutMs).toBe(55000);
    expect(pricingRule?.billingMode).toBe("fixed_credits");
    expect(pricingRule?.fixedCredits).toBe(8);
  });
});
