import type { NextRequest, NextResponse } from "next/server";

/**
 * 分销归因 Cookie 名称
 */
export const DISTRIBUTION_ATTRIBUTION_COOKIE = "distribution_attribution";

/**
 * 分销访客标识 Cookie 名称
 */
export const DISTRIBUTION_VISITOR_COOKIE = "distribution_visitor";

/**
 * 归因锁定天数
 */
export const DISTRIBUTION_ATTRIBUTION_WINDOW_DAYS = 30;

/**
 * Referral Cookie 载荷
 */
export interface DistributionAttributionCookiePayload {
  referralCode: string;
  campaign: string | null;
  landingPath: string;
  source: string;
  capturedAt: string;
  visitorKey: string;
}

/**
 * 对归因 Cookie 做编码
 */
export function encodeAttributionCookie(
  payload: DistributionAttributionCookiePayload
) {
  return encodeURIComponent(JSON.stringify(payload));
}

/**
 * 解析归因 Cookie
 */
export function decodeAttributionCookie(
  value: string | undefined
): DistributionAttributionCookiePayload | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(
      decodeURIComponent(value)
    ) as DistributionAttributionCookiePayload;
  } catch {
    return null;
  }
}

/**
 * 从请求中提取归因参数
 */
export function getAttributionCookiePayloadFromRequest(
  request: NextRequest
): DistributionAttributionCookiePayload | null {
  const referralCode = request.nextUrl.searchParams.get("ref");
  if (!referralCode) {
    return null;
  }

  const existingVisitorKey =
    request.cookies.get(DISTRIBUTION_VISITOR_COOKIE)?.value;

  return {
    referralCode,
    campaign: request.nextUrl.searchParams.get("campaign"),
    landingPath: request.nextUrl.pathname,
    source: "query",
    capturedAt: new Date().toISOString(),
    visitorKey: existingVisitorKey ?? crypto.randomUUID(),
  };
}

/**
 * 把归因信息写回响应 Cookie
 */
export function applyAttributionCookies(
  request: NextRequest,
  response: NextResponse
) {
  const payload = getAttributionCookiePayloadFromRequest(request);
  if (!payload) {
    return response;
  }

  const maxAge = DISTRIBUTION_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60;

  response.cookies.set(DISTRIBUTION_VISITOR_COOKIE, payload.visitorKey, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge,
  });

  response.cookies.set(
    DISTRIBUTION_ATTRIBUTION_COOKIE,
    encodeAttributionCookie(payload),
    {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge,
    }
  );

  return response;
}
