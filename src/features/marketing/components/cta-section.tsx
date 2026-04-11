"use client";

import { useLocale } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";

interface CTAUser {
  id: string;
}

interface CTASectionProps {
  user?: CTAUser | null;
}

export function CTASection({ user }: CTASectionProps) {
  const locale = useLocale();
  const router = useRouter();
  const isZh = locale === "zh";
  const { data: session } = useSession();
  const currentUser = user ?? session?.user ?? null;

  /**
   * 跳转到订阅区域
   */
  const handleSubscriptionEntry = () => {
    if (!currentUser) {
      router.push("/sign-up");
      return;
    }
    const pricingSection = document.getElementById("pricing");
    if (pricingSection) {
      pricingSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative overflow-hidden bg-[#10131a] px-8 py-24 text-[#e1e2eb] sm:px-6 lg:px-8 lg:py-40">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[26rem] w-[50rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#aac7ff]/10 blur-[150px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl">
        <div className="flex flex-col gap-8 md:hidden">
          <h2 className="font-['Manrope'] text-4xl font-bold leading-tight tracking-[-0.05em]">
            {isZh
              ? "为未来的\n创作者而生".split("\n").map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))
              : "Made for the next wave of creators"}
          </h2>
          <div className="w-full rounded-[2rem] border border-white/5 bg-[#191c22] p-8">
            <p className="mb-6 text-sm leading-7 text-[#c0c6d6]">
              {isZh
                ? "我们相信，技术不应成为创意的阻碍。Trip 旅行者 AI 通过极简的交互界面，将生成式 AI 能力封装进每一个直觉化操作中。"
                : "We believe tools should remove friction from creative work. Trip Traveler AI wraps generative workflows into clear, direct actions that stay usable on the go."}
            </p>
            <div className="flex flex-col gap-3">
              {currentUser ? (
                <>
                  <Button
                    asChild
                    className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] text-sm font-bold text-[#003064]"
                  >
                    <Link href="/dashboard">
                      {isZh ? "进入控制台" : "Open Dashboard"}
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    className="h-12 w-full rounded-full border border-white/10 bg-white/[0.04] text-[#e1e2eb] hover:bg-white/[0.08] hover:text-[#e1e2eb]"
                  >
                    <Link href="/dashboard/support">
                      {isZh ? "查看我的工单" : "Open Support"}
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    className="h-12 w-full rounded-full border border-white/10 bg-white/[0.04] text-[#e1e2eb] hover:bg-white/[0.08] hover:text-[#e1e2eb]"
                  >
                    <Link href="/docs">
                      {isZh ? "了解我们的愿景" : "Read Our Vision"}
                    </Link>
                  </Button>
                  <Button
                    onClick={handleSubscriptionEntry}
                    className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] text-sm font-bold text-[#003064]"
                  >
                    {isZh ? "立即订阅" : "Subscribe Now"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="hidden text-center md:block">
          <h2 className="mb-8 font-['Manrope'] text-4xl font-bold tracking-[-0.05em] md:text-6xl">
            {isZh ? "立即开启您的 AI 之旅" : "Start Your AI Journey Now"}
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-lg text-[#c0c6d6] opacity-80 md:text-xl">
            {isZh
              ? "加入全球超过 100 万名创作者的行列，利用 AI 的力量突破创意的天花板。"
              : "Join more than one million creators using AI to move beyond creative bottlenecks."}
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            {currentUser ? (
              <>
                <Button
                  asChild
                  className="h-14 w-full rounded-2xl bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-10 text-base font-bold text-[#003064] shadow-xl shadow-blue-500/20 transition-transform hover:scale-105 sm:w-auto"
                >
                  <Link href="/dashboard">
                    {isZh ? "进入控制台" : "Open Dashboard"}
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-10 text-base font-bold text-[#e1e2eb] backdrop-blur-md transition-colors hover:bg-white/[0.08] hover:text-[#e1e2eb] sm:w-auto"
                >
                  <Link href="/dashboard/support">
                    {isZh ? "查看我的工单" : "Open Support"}
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleSubscriptionEntry}
                  className="h-14 w-full rounded-2xl bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-10 text-base font-bold text-[#003064] shadow-xl shadow-blue-500/20 transition-transform hover:scale-105 sm:w-auto"
                >
                  {isZh ? "立即订阅" : "Subscribe Now"}
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-10 text-base font-bold text-[#e1e2eb] backdrop-blur-md transition-colors hover:bg-white/[0.08] hover:text-[#e1e2eb] sm:w-auto"
                >
                  <Link href="/#pricing">
                    {isZh ? "查看订阅方案" : "View Plans"}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
