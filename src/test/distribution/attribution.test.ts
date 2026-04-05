import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyAttributionCookies,
  decodeAttributionCookie,
  DISTRIBUTION_ATTRIBUTION_COOKIE,
  DISTRIBUTION_VISITOR_COOKIE,
  encodeAttributionCookie,
  getAttributionCookiePayloadFromRequest,
} from "@/features/distribution/attribution-cookie";
import { resolveCheckoutAttributionFromPayload } from "@/features/distribution/attribution";
import { distributionAttribution } from "@/db/schema";
import {
  cleanupTestUsers,
  createTestDistributionProfile,
  createTestReferralCode,
  createTestUser,
  testDb,
} from "../utils";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

describe("Distribution Attribution Cookie", () => {
  it("应该正确编码和解析归因 cookie", () => {
    const encoded = encodeAttributionCookie({
      referralCode: "agent001",
      campaign: "spring",
      landingPath: "/pricing",
      source: "query",
      capturedAt: "2026-04-05T00:00:00.000Z",
      visitorKey: "visitor-1",
    });

    expect(decodeAttributionCookie(encoded)).toEqual({
      referralCode: "agent001",
      campaign: "spring",
      landingPath: "/pricing",
      source: "query",
      capturedAt: "2026-04-05T00:00:00.000Z",
      visitorKey: "visitor-1",
    });
  });

  it("应该从请求中提取 ref 和 campaign", () => {
    const request = new NextRequest(
      "https://example.com/zh/pricing?ref=agent001&campaign=spring"
    );

    const payload = getAttributionCookiePayloadFromRequest(request);
    expect(payload).not.toBeNull();
    expect(payload!.referralCode).toBe("agent001");
    expect(payload!.campaign).toBe("spring");
    expect(payload!.landingPath).toBe("/zh/pricing");
  });

  it("写 cookie 时应该同时写归因和访客标识", () => {
    const request = new NextRequest("https://example.com/?ref=agent001");
    const response = applyAttributionCookies(request, NextResponse.next());

    expect(
      response.cookies.get(DISTRIBUTION_ATTRIBUTION_COOKIE)?.value
    ).toBeDefined();
    expect(response.cookies.get(DISTRIBUTION_VISITOR_COOKIE)?.value).toBeDefined();
  });
});

describe("Distribution Attribution Binding", () => {
  it("应该根据推广码为用户创建归因快照", async () => {
    const agent = await createTestUser();
    const buyer = await createTestUser();
    createdUserIds.push(agent.id, buyer.id);

    await createTestDistributionProfile({
      userId: agent.id,
      displayName: "Agent A",
    });

    await createTestReferralCode({
      agentUserId: agent.id,
      code: "agent-a",
      campaign: "launch",
      landingPath: "/pricing",
    });

    const attribution = await resolveCheckoutAttributionFromPayload(buyer.id, {
      referralCode: "agent-a",
      campaign: "launch",
      landingPath: "/pricing",
      source: "query",
      capturedAt: new Date().toISOString(),
      visitorKey: "visitor-a",
    });

    expect(attribution).not.toBeNull();
    expect(attribution!.referralCode).toBe("agent-a");
    expect(attribution!.attributedAgentUserId).toBe(agent.id);

    const rows = await testDb
      .select()
      .from(distributionAttribution)
      .where(eq(distributionAttribution.userId, buyer.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentUserId).toBe(agent.id);
  });

  it("重复绑定时应该复用现有归因快照", async () => {
    const agent = await createTestUser();
    const buyer = await createTestUser();
    createdUserIds.push(agent.id, buyer.id);

    await createTestDistributionProfile({
      userId: agent.id,
    });
    await createTestReferralCode({
      agentUserId: agent.id,
      code: "agent-reuse",
    });

    const first = await resolveCheckoutAttributionFromPayload(buyer.id, {
      referralCode: "agent-reuse",
      campaign: null,
      landingPath: "/",
      source: "query",
      capturedAt: new Date().toISOString(),
      visitorKey: "visitor-reuse",
    });

    const second = await resolveCheckoutAttributionFromPayload(buyer.id, {
      referralCode: "agent-reuse",
      campaign: "other",
      landingPath: "/pricing",
      source: "query",
      capturedAt: new Date().toISOString(),
      visitorKey: "visitor-reuse",
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.attributionId).toBe(first!.attributionId);

    const rows = await testDb
      .select()
      .from(distributionAttribution)
      .where(eq(distributionAttribution.userId, buyer.id));

    expect(rows).toHaveLength(1);
  });

  it("无效推广码不应该创建归因快照", async () => {
    const buyer = await createTestUser();
    createdUserIds.push(buyer.id);

    const attribution = await resolveCheckoutAttributionFromPayload(buyer.id, {
      referralCode: "missing-code",
      campaign: null,
      landingPath: "/pricing",
      source: "query",
      capturedAt: new Date().toISOString(),
      visitorKey: "visitor-missing",
    });

    expect(attribution).toBeNull();

    const rows = await testDb
      .select()
      .from(distributionAttribution)
      .where(eq(distributionAttribution.userId, buyer.id));

    expect(rows).toHaveLength(0);
  });
});
