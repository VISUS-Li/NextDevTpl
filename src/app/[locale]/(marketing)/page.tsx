import type { Metadata } from "next";

import { siteConfig } from "@/config";
import { SiteJsonLd, SoftwareAppJsonLd } from "@/components/seo/json-ld";
import {
  CTASection,
  FAQSection,
  FeatureGrid,
  HeroSection,
  HowItWorks,
  PricingSection,
  Testimonials,
  UseCasesSection,
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
    ? "Trip - 工具销售官网"
    : "Trip - Tool Storefront";

  const description = isZh
    ? "Trip 是一个面向个人与团队的工具销售网站，用于展示、订阅和管理效率工具、AI 工具与数字产品。"
    : "Trip is a storefront for browsing, buying, and subscribing to practical productivity tools, AI tools, and digital products.";

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
      <HowItWorks />
      <UseCasesSection />
      <Testimonials />
      <PricingSection />
      <FAQSection />
      <CTASection />
    </>
  );
}
