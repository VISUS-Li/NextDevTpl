"use client";

import { Github } from "lucide-react";
import { useLocale } from "next-intl";

import { footerNav, siteConfig } from "@/config";
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

  return (
    <footer className="border-t border-white/5 bg-[#0b0e14] px-4 py-12 text-sm text-[#e1e2eb] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex flex-col items-center gap-4 md:items-start">
          <Link href="/" className="font-['Manrope'] text-xl font-bold">
            {isZh ? "Trip 旅行者 AI" : "Trip Traveler AI"}
          </Link>
          <p className="text-center text-[#e1e2eb]/50 md:text-left">
            © {new Date().getFullYear()}{" "}
            {isZh ? "Trip 旅行者 AI. 旅行，从 AI 开始。" : "Trip Traveler AI. Start the journey with AI."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 md:justify-end md:gap-8">
          {footerNav.legal.slice(0, 2).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[#e1e2eb]/50 transition-colors hover:text-[#0A84FF]"
            >
              {link.href.includes("privacy")
                ? isZh
                  ? "隐私政策"
                  : "Privacy"
                : isZh
                  ? "服务条款"
                  : "Terms"}
            </Link>
          ))}
          <Link
            href={siteConfig.links.github}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[#e1e2eb]/50 transition-colors hover:text-[#0A84FF]"
          >
            <Github className="h-5 w-5" />
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  );
}
