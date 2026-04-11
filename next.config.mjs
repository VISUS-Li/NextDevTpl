import { createMDX } from "fumadocs-mdx/next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * 创建 Fumadocs MDX 插件
 */
const withMDX = createMDX();

/**
 * 创建 next-intl 插件
 * 指定国际化请求配置文件路径
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 开发阶段关闭右下角状态指示器，减少页面遮挡。
  devIndicators: false,
  // 允许局域网入口访问开发资源，避免频繁跨域告警。
  allowedDevOrigins: [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://10.0.160.121:3000",
    "http://100.121.210.82:3000",
    "https://platform.tripai.icu",
  ],
  // Exclude packages with webpack-specific syntax from server bundling
  serverExternalPackages: ["anki-apkg-export", "sql.js", "pino", "pino-pretty", "@axiomhq/pino"],
};

// 组合插件: MDX -> NextIntl -> NextConfig
export default withMDX(withNextIntl(nextConfig));
