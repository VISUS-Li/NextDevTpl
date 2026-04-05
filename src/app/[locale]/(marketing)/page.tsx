import type { Metadata } from "next";

import { siteConfig } from "@/config";
import { SiteJsonLd, SoftwareAppJsonLd } from "@/components/seo/json-ld";
import {
  CTASection,
  FeatureGrid,
  HeroSection,
  PricingSection,
} from "@/features/marketing/components";

/**
 * 生成首页 Metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "Trip 旅行者 AI - 让创意触手可及"
    : "Trip Traveler AI - Make Ideas Reachable";

  const description = isZh
    ? "Trip 旅行者 AI 提供面向创作者与团队的专业级 AI 工具集，覆盖文案、视频与 3D 创作流程。"
    : "Trip Traveler AI offers professional AI creation tools for copy, video, and 3D production workflows.";

  return {
    title,
    description,
    keywords: [
      "tool storefront",
      "digital tools",
      "AI tools",
      "productivity tools",
      "subscriptions",
      ...(isZh ? ["工具商城", "数字工具", "AI工具", "效率工具"] : []),
    ],
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}`,
      siteName: siteConfig.name,
      images: [
        {
          url: `${siteConfig.url}${siteConfig.ogImage}`,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteConfig.url}${siteConfig.ogImage}`],
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <>
      {/* JSON-LD Structured Data */}
      <SiteJsonLd locale={locale as "en" | "zh"} />
      <SoftwareAppJsonLd locale={locale as "en" | "zh"} />

      {/* Page Sections */}
      <HeroSection />
      <FeatureGrid />
      <PricingSection />
      <CTASection />
    </>
  );
}
