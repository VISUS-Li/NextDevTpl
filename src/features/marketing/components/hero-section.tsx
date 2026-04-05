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
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#10131a] px-4 pb-20 pt-32 text-[#e1e2eb] sm:px-6 lg:px-8">
      {/* 首页背景光效 */}
      <div className="absolute inset-0">
        <div className="absolute left-[-10%] top-[-10%] h-[28rem] w-[28rem] rounded-full bg-blue-600/12 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-cyan-400/12 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <h1 className="mb-8 font-['Manrope'] text-5xl font-extrabold leading-[1.05] tracking-[-0.06em] md:text-7xl lg:text-8xl">
          {isZh ? "让创意" : "Make Every Idea"}
          <span className="bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] bg-clip-text text-transparent">
            {isZh ? "触手可及" : "Reachable"}
          </span>
        </h1>

        <p className="mb-12 max-w-2xl text-lg leading-8 text-[#c0c6d6] md:text-2xl md:leading-10">
          {isZh
            ? "专业级 AI 创作工具集，重塑您的创作流。从文字到 3D，每一个灵感都在此刻加速落地。"
            : "A professional AI creation suite for modern teams. From copy to 3D, every spark moves into production faster."}
        </p>

        <div className="flex w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row sm:gap-6">
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
            <Link href="/docs">
              {isZh ? "了解更多细节" : "View Details"}
            </Link>
          </Button>
        </div>
      </div>

      <Link
        href="/#features"
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[#e1e2eb]/40 transition-colors hover:text-[#e1e2eb]/70"
      >
        <ChevronDown className="h-8 w-8 animate-bounce" />
      </Link>
    </section>
  );
}
