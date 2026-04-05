/**
 * 站点配置
 *
 * 集中管理站点的基本信息，用于 SEO、元数据、页脚等
 */
export const siteConfig = {
  /** 站点名称 */
  name: "Trip 旅行者 AI",

  /** 站点描述 */
  description:
    "Trip Traveler AI offers professional AI creation tools for copy, video, and 3D production workflows.",

  /** 站点 URL (生产环境) */
  url: process.env.NEXT_PUBLIC_APP_URL || "https://example.com",

  /** OG 图片 URL */
  ogImage: "/og-image.png",

  /** 作者信息 */
  author: {
    name: "Trip Traveler AI Team",
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
    "Trip Traveler AI",
    "AI creation tools",
    "copy generation",
    "video generation",
    "3D rendering",
    "creative workflow",
    "AI tools",
  ],
} as const;

/**
 * 站点配置类型
 */
export type SiteConfig = typeof siteConfig;
