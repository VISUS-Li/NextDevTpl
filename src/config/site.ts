/**
 * 站点配置
 *
 * 集中管理站点的基本信息，用于 SEO、元数据、页脚等
 */
export const siteConfig = {
  /** 站点名称 */
  name: "Trip",

  /** 站点描述 */
  description:
    "Trip is a tool storefront for discovering, selling, and subscribing to practical digital tools.",

  /** 站点 URL (生产环境) */
  url: process.env.NEXT_PUBLIC_APP_URL || "https://example.com",

  /** OG 图片 URL */
  ogImage: "/og-image.png",

  /** 作者信息 */
  author: {
    name: "Trip Team",
    url: "https://example.com",
    email: "support@trip.local",
  },

  /** 社交链接 */
  links: {
    twitter: "https://twitter.com/trip",
    github: "https://github.com/VISUS-Li/NextDevTpl",
    discord: "https://discord.gg/trip",
  },

  /** 关键词 (SEO) */
  keywords: [
    "Trip",
    "Tools Store",
    "Digital Tools",
    "AI Tools",
    "Productivity Tools",
    "Subscriptions",
    "Payments",
  ],
} as const;

/**
 * 站点配置类型
 */
export type SiteConfig = typeof siteConfig;
