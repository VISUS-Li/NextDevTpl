import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { distributionAttribution, distributionReferralCode } from "@/db/schema";
import {
  DISTRIBUTION_ATTRIBUTION_COOKIE,
  DISTRIBUTION_ATTRIBUTION_WINDOW_DAYS,
  type DistributionAttributionCookiePayload,
  decodeAttributionCookie,
} from "./attribution-cookie";

/**
 * Checkout 归因上下文
 */
export interface CheckoutAttributionContext {
  attributionId: string;
  referralCode: string;
  attributedAgentUserId: string;
  campaign: string | null;
  landingPath: string;
  visitorKey: string;
}

/**
 * 获取当前请求中的归因 Cookie
 */
export async function getAttributionCookiePayload() {
  // 某些接口测试和后台流程没有 Next 请求上下文，此时直接跳过归因 cookie 读取。
  try {
    const cookieStore = await cookies();
    return decodeAttributionCookie(
      cookieStore.get(DISTRIBUTION_ATTRIBUTION_COOKIE)?.value
    );
  } catch {
    return null;
  }
}

/**
 * 解析当前用户的 Checkout 归因
 *
 * 这里只做最小绑定：
 * - 读 cookie
 * - 校验 referral code
 * - 为当前用户写一条 attribution 快照
 */
export async function resolveCheckoutAttribution(
  userId: string
): Promise<CheckoutAttributionContext | null> {
  const payload = await getAttributionCookiePayload();
  if (!payload) {
    return null;
  }

  return resolveCheckoutAttributionFromPayload(userId, payload);
}

/**
 * 使用给定 payload 解析 Checkout 归因
 */
export async function resolveCheckoutAttributionFromPayload(
  userId: string,
  payload: DistributionAttributionCookiePayload
): Promise<CheckoutAttributionContext | null> {
  const [referral] = await db
    .select()
    .from(distributionReferralCode)
    .where(
      and(
        eq(distributionReferralCode.code, payload.referralCode),
        eq(distributionReferralCode.status, "active")
      )
    )
    .limit(1);

  if (!referral) {
    return null;
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(distributionAttribution)
    .where(
      and(
        eq(distributionAttribution.userId, userId),
        gt(distributionAttribution.expiresAt, now)
      )
    )
    .limit(1);

  if (existing) {
    return {
      attributionId: existing.id,
      referralCode: existing.referralCode,
      attributedAgentUserId: existing.agentUserId,
      campaign: existing.campaign,
      landingPath: existing.landingPath ?? "/",
      visitorKey: existing.visitorKey ?? payload.visitorKey,
    };
  }

  const attributionId = crypto.randomUUID();
  const expiresAt = new Date(
    now.getTime() + DISTRIBUTION_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  await db.insert(distributionAttribution).values({
    id: attributionId,
    visitorKey: payload.visitorKey,
    userId,
    agentUserId: referral.agentUserId,
    referralCode: payload.referralCode,
    campaign: payload.campaign,
    landingPath: payload.landingPath,
    source: payload.source,
    boundReason: "checkout",
    boundAt: now,
    expiresAt,
    snapshot: {
      referralCode: payload.referralCode,
      campaign: payload.campaign,
      landingPath: payload.landingPath,
      source: payload.source,
      referralId: referral.id,
      agentUserId: referral.agentUserId,
    },
  });

  return {
    attributionId,
    referralCode: payload.referralCode,
    attributedAgentUserId: referral.agentUserId,
    campaign: payload.campaign,
    landingPath: payload.landingPath,
    visitorKey: payload.visitorKey,
  };
}

/**
 * 构造 Checkout metadata 里的归因字段
 */
export async function buildCheckoutAttributionMetadata(userId: string) {
  const attribution = await resolveCheckoutAttribution(userId);
  if (!attribution) {
    return {};
  }

  return {
    referralCode: attribution.referralCode,
    attributedAgentUserId: attribution.attributedAgentUserId,
    attributionId: attribution.attributionId,
    campaign: attribution.campaign ?? "",
    landingPath: attribution.landingPath,
    visitorKey: attribution.visitorKey,
  };
}
