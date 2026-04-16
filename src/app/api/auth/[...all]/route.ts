import { toNextJsHandler } from "better-auth/next-js";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth/index";

/**
 * Better Auth API 路由处理器
 *
 * 此文件处理所有 /api/auth/* 请求
 * Better Auth 自动处理:
 * - /api/auth/sign-in - 登录
 * - /api/auth/sign-up - 注册
 * - /api/auth/sign-out - 登出
 * - /api/auth/session - 获取会话
 * - /api/auth/callback/* - OAuth 回调
 * - 等等...
 */
const authHandlers = toNextJsHandler(auth);

async function syncAuthBaseUrl(request: Request) {
  // 每次请求都按当前入口域名覆盖回调地址，避免多域名共用一个实例时串到 platform 域名。
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const requestUrl = new URL(request.url);
  const origin =
    forwardedProto && forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : requestUrl.origin;

  const context = await auth.$context;
  context.options.baseURL = origin;
  context.baseURL = `${origin}${context.options.basePath || "/api/auth"}`;
}

const handleGet = async (request: Request) => {
  await syncAuthBaseUrl(request);
  return authHandlers.GET(request);
};

const handlePost = async (request: Request) => {
  await syncAuthBaseUrl(request);
  return authHandlers.POST(request);
};

export const GET = withApiLogging(handleGet);
export const POST = withApiLogging(handlePost);
