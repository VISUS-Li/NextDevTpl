import { headers } from "next/headers";

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
  try {
    return await auth.api.getSession({
      headers: await headers(),
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
