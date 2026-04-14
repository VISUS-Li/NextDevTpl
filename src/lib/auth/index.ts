import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha } from "better-auth/plugins";

import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  ResetPasswordEmail,
  VerifyEmailEmail,
} from "@/features/mail/templates/primary-action-email";
import { sendEmail } from "@/features/mail/utils";

const STATIC_TRUSTED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.BETTER_AUTH_URL,
  process.env.REDINK_PUBLIC_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://10.0.160.121:3000",
  "http://10.0.160.121:8082",
  "http://10.0.160.121:8083",
  "http://100.121.210.82:3000",
  "http://100.121.210.82:8082",
  "http://100.121.210.82:8083",
  "https://platform.tripai.icu",
  "https://jingfang.tripai.icu",
  "https://redink.tripai.icu",
  "https://*.trycloudflare.com",
];

/**
 * 返回认证可接受的来源列表
 */
async function getTrustedOrigins(request?: Request) {
  // 统一放行固定域名、局域网地址和当前请求实际来源，避免多入口访问时触发 INVALID_ORIGIN。
  const origins = [...STATIC_TRUSTED_ORIGINS];

  if (request) {
    origins.push(new URL(request.url).origin);
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin) {
      origins.push(requestOrigin);
    }

    const forwardedProto = request.headers.get("x-forwarded-proto");
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (forwardedProto && forwardedHost) {
      origins.push(`${forwardedProto}://${forwardedHost}`);
    }
  }

  return [...new Set(origins.filter(Boolean))];
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
const turnstileEnabled = Boolean(turnstileSiteKey && turnstileSecretKey);

/**
 * Better Auth 服务端配置
 *
 * 此文件配置 Better Auth 的核心功能:
 * - 数据库适配器 (Drizzle + PostgreSQL)
 * - OAuth 提供商 (GitHub, Google)
 * - 会话配置
 * - 用户自定义字段
 */
export const auth = betterAuth({
  /**
   * 认证回调地址跟随当前请求域名
   * RedInk 代理登录时必须返回 redink 自己的回调地址
   */

  /**
   * 开发环境允许 HTTP 调试登录，生产环境继续使用安全 Cookie
   */
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  /**
   * 信任的来源
   * 允许从这些来源发起认证请求
   */
  trustedOrigins: getTrustedOrigins,

  /**
   * 数据库配置
   * 使用 Drizzle 适配器连接 PostgreSQL
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  /**
   * 用户自定义字段配置
   * 将 role, banned, bannedReason 字段包含在会话用户中
   */
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false, // 用户不能通过注册/更新设置此字段
      },
      banned: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // 用户不能通过注册/更新设置此字段
      },
      bannedReason: {
        type: "string",
        required: false,
        input: false, // 用户不能通过注册/更新设置此字段
      },
    },
  },

  /**
   * 邮箱密码认证配置
   */
  emailAndPassword: {
    enabled: true,
    // 官网以快速注册和立即体验为主，开发和演示环境不强制邮箱验证
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password - Trip",
        react: ResetPasswordEmail({
          resetUrl: url,
          name: user.name || "there",
        }),
      });
    },
  },

  /**
   * 邮箱验证配置
   */
  emailVerification: {
    // 保留验证能力，但默认不在注册后阻塞登录
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email - Trip",
        react: VerifyEmailEmail({
          verifyUrl: url,
          name: user.name || "there",
        }),
      });
    },
  },

  /**
   * OAuth 社交登录提供商配置
   * 需要在 .env 中配置相应的 Client ID 和 Secret
   */
  socialProviders: {
    /**
     * GitHub OAuth 配置
     * 获取凭证: https://github.com/settings/developers
     */
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    },

    /**
     * Google OAuth 配置
     * 获取凭证: https://console.cloud.google.com/apis/credentials
     */
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },

  /**
   * 会话配置
   */
  session: {
    // 会话过期时间: 7 天
    expiresIn: 60 * 60 * 24 * 7,
    // 刷新阈值: 1 天 (会话剩余不足 1 天时自动刷新)
    updateAge: 60 * 60 * 24,
    // 使用 Cookie 存储会话
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 分钟缓存
    },
  },

  /**
   * 登录前的人机校验
   * 仅拦邮箱密码登录，避免影响现有 OAuth 流程
   */
  plugins: turnstileEnabled
    ? [
        captcha({
          provider: "cloudflare-turnstile",
          secretKey: turnstileSecretKey || "",
          endpoints: ["/sign-in/email"],
        }),
      ]
    : [],
});

/**
 * 导出类型以供其他模块使用
 */
export type Auth = typeof auth;
