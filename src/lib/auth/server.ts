import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "./index";

/**
 * 判断是否为常见的失效会话错误
 */
function isExpiredSessionError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("failed query") ||
    message.includes('from "session"') ||
    message.includes("failed to get session")
  );
}

/**
 * 检查请求是否携带会话 Cookie。
 */
function hasSessionToken(cookieHeader: string) {
  return (
    cookieHeader.includes("better-auth.session_token=") ||
    cookieHeader.includes("__Secure-better-auth.session_token=")
  );
}

/**
 * 构造认证读取所需的最小请求头。
 */
function createSessionHeaders(
  cookieHeader: string,
  host: string,
  forwardedHost: string,
  forwardedProto: string
) {
  const requestHeaders = new Headers();

  if (cookieHeader) {
    requestHeaders.set("cookie", cookieHeader);
  }
  if (host) {
    requestHeaders.set("host", host);
  }
  if (forwardedHost) {
    requestHeaders.set("x-forwarded-host", forwardedHost);
  }
  if (forwardedProto) {
    requestHeaders.set("x-forwarded-proto", forwardedProto);
  }

  return requestHeaders;
}

/**
 * 单请求内复用 session 查询结果，避免重复查库。
 */
const getCachedServerSession = cache(
  async (
    cookieHeader: string,
    host: string,
    forwardedHost: string,
    forwardedProto: string
  ) => {
    try {
      return await auth.api.getSession({
        headers: createSessionHeaders(
          cookieHeader,
          host,
          forwardedHost,
          forwardedProto
        ),
      });
    } catch (error) {
      if (isExpiredSessionError(error)) {
        console.warn("检测到失效的登录状态，已按未登录处理，请重新登录");
        return null;
      }

      console.error(
        "获取登录状态失败，已按未登录处理",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
);

/**
 * 服务器端获取当前用户会话
 *
 * 用于 Server Components 和 Server Actions 中获取用户信息
 *
 * @example
 * ```tsx
 * // 在 Server Component 中使用
 * export default async function Page() {
 *   const session = await getServerSession();
 *   if (!session) {
 *     redirect("/sign-in");
 *   }
 *   return <div>Welcome, {session.user.name}</div>;
 * }
 * ```
 */
export async function getServerSession() {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie") ?? "";

  // 无会话 Cookie 时直接返回，避免匿名访问也触发数据库查询。
  if (!hasSessionToken(cookieHeader)) {
    return null;
  }

  return await getCachedServerSession(
    cookieHeader,
    requestHeaders.get("host") ?? "",
    requestHeaders.get("x-forwarded-host") ?? "",
    requestHeaders.get("x-forwarded-proto") ?? ""
  );
}

/**
 * 获取当前用户
 *
 * 便捷方法，直接返回用户对象或 null
 */
export async function getCurrentUser() {
  const session = await getServerSession();
  return session?.user ?? null;
}

/**
 * 检查用户是否已认证
 *
 * @returns boolean - 用户是否已登录
 */
export async function isAuthenticated() {
  const session = await getServerSession();
  return !!session?.user;
}
