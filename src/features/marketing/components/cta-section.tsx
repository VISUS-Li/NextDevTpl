"use client";

import { useLocale } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";

export function CTASection() {
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const isZh = locale === "zh";

  /**
   * 跳转到订阅区域
   */
  const handleSubscriptionEntry = () => {
    if (!session?.user) {
      router.push("/sign-up");
      return;
    }
    const pricingSection = document.getElementById("pricing");
    if (pricingSection) {
      pricingSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative overflow-hidden bg-[#10131a] px-4 py-28 text-[#e1e2eb] sm:px-6 lg:px-8 lg:py-40">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[26rem] w-[50rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#aac7ff]/10 blur-[150px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <h2 className="mb-8 font-['Manrope'] text-4xl font-bold tracking-[-0.05em] md:text-6xl">
          {isZh ? "立即开启您的 AI 之旅" : "Start Your AI Journey Now"}
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-lg text-[#c0c6d6] opacity-80 md:text-xl">
          {isZh
            ? "加入全球超过 100 万名创作者的行列，利用 AI 的力量突破创意的天花板。"
            : "Join more than one million creators using AI to move beyond creative bottlenecks."}
        </p>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
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
        </div>
      </div>
    </section>
  );
}
