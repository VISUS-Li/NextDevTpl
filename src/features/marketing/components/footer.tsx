"use client";

import { Github } from "lucide-react";
import { useLocale } from "next-intl";

import { footerNav, siteConfig } from "@/config";
import { LanguageSwitcher, ModeToggle } from "@/features/shared";
import { Link } from "@/i18n/routing";

/**
 * Marketing 页面底部
 *
 * 功能:
 * - 品牌信息 + 产品描述
 * - 产品、法律链接
 * - 社交媒体链接
 * - 版权信息
 */
export function Footer() {
  const locale = useLocale();
  const isZh = locale === "zh";
  const quickLinks = [
    { href: "/docs", label: isZh ? "文档" : "Docs" },
    { href: "/blog", label: "Blog" },
    { href: "/pseo", label: "PSEO" },
  ];
  const legalLabels: Record<string, string> = {
    "/legal/terms": isZh ? "服务条款" : "Terms",
    "/legal/privacy": isZh ? "隐私政策" : "Privacy",
    "/legal/cookie-policy": isZh ? "Cookie 政策" : "Cookies",
  };

  return (
    <footer className="border-t border-white/5 bg-[#0b0e14] px-8 py-12 text-sm text-[#e1e2eb] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col items-center gap-4 md:items-start">
          <Link
            href="/"
            className="font-['Manrope'] text-lg font-bold md:text-xl"
          >
            {isZh ? "Trip 旅行者 AI" : "Trip Traveler AI"}
          </Link>
          <div className="flex items-center gap-2 md:hidden">
            <LanguageSwitcher />
            <ModeToggle />
          </div>
          <p className="text-center text-xs leading-6 text-[#e1e2eb]/50 md:text-left md:text-sm">
            © {new Date().getFullYear()}{" "}
            {isZh
              ? "Trip 旅行者 AI. 旅行，从 AI 开始。"
              : "Trip Traveler AI. Start the journey with AI."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 md:justify-end md:gap-8">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[#e1e2eb]/50 transition-colors hover:text-[#0A84FF]"
            >
              {link.label}
            </Link>
          ))}

          {footerNav.legal.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[#e1e2eb]/50 transition-colors hover:text-[#0A84FF]"
            >
              {legalLabels[link.href] || link.title}
            </Link>
          ))}
          <Link
            href={siteConfig.links.github}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-[#e1e2eb]/50 transition-colors hover:text-[#0A84FF]"
          >
            <Github className="h-5 w-5" />
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  );
}
