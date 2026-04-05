"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useLocale } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

/**
 * Hero Section 组件
 *
 * NextDevTpl 产品主页 Hero 区域
 * - 简洁现代的 Vercel 风格
 * - 信任标识（头像组 + 文案）
 */
export function HeroSection() {
  const locale = useLocale();
  const isZh = locale === "zh";

  return (
    <section className="relative overflow-hidden bg-[#10131a] px-6 pb-20 pt-40 text-[#e1e2eb] md:flex md:min-h-screen md:flex-col md:items-center md:justify-center md:px-8 md:pb-20 md:pt-32">
      <div className="absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[31.25rem] w-[140%] -translate-x-1/2 bg-[radial-gradient(circle_at_center,rgba(10,132,255,0.15)_0%,transparent_70%)] md:hidden" />
        <div className="absolute left-[-10%] top-[-10%] hidden h-[28rem] w-[28rem] rounded-full bg-blue-600/12 blur-[120px] md:block" />
        <div className="absolute bottom-[-10%] right-[-10%] hidden h-[28rem] w-[28rem] rounded-full bg-cyan-400/12 blur-[120px] md:block" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center text-center md:max-w-4xl">
        <h1 className="mb-6 font-['Manrope'] text-5xl font-extrabold leading-[1.08] tracking-[-0.05em] md:mb-8 md:text-7xl lg:text-8xl">
          {isZh ? (
            <>
              让创意
              <br className="md:hidden" />
              <span className="bg-gradient-to-r from-[#0A84FF] to-[#5AC8FA] bg-clip-text text-transparent">
                触手可及
              </span>
            </>
          ) : (
            <>
              Make Every Idea
              <br className="md:hidden" />
              <span className="bg-gradient-to-r from-[#0A84FF] to-[#5AC8FA] bg-clip-text text-transparent">
                Reachable
              </span>
            </>
          )}
        </h1>

        <p className="mb-10 max-w-md px-4 text-lg leading-8 text-[#c0c6d6] md:mb-12 md:max-w-2xl md:px-0 md:text-2xl md:leading-10">
          {isZh
            ? "下一代 AI 创意引擎，为创作者、开发者与梦想家量身打造的极简工具集。"
            : "A next-generation AI creation engine for builders, creators, and dreamers who want fewer steps between idea and output."}
        </p>

        <div className="hidden w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row sm:gap-6 md:flex">
          <Button
            asChild
            className="group relative h-14 w-full rounded-2xl bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-8 text-base font-bold text-[#003064] shadow-[0_0_30px_rgba(10,132,255,0.22)] transition-all hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(10,132,255,0.35)] sm:w-auto"
          >
            <Link href="/sign-up">
              {isZh ? "免费开始使用" : "Start Free"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-8 text-base font-bold text-[#e1e2eb] backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-[#e1e2eb] sm:w-auto"
          >
            <Link href="/docs">{isZh ? "了解更多细节" : "View Details"}</Link>
          </Button>
        </div>

        <div className="pt-2 md:hidden">
          <Link
            href="/#features"
            className="inline-flex items-center gap-2 text-base font-medium text-[#74d1ff] transition-opacity hover:opacity-80"
          >
            {isZh ? "探索工具系列" : "Explore the toolkit"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <Link
        href="/#features"
        className="absolute bottom-10 left-1/2 hidden -translate-x-1/2 text-[#e1e2eb]/40 transition-colors hover:text-[#e1e2eb]/70 md:block"
      >
        <ChevronDown className="h-8 w-8 animate-bounce" />
      </Link>
    </section>
  );
}
