"use client";

import { BookOpen, Check, Coins, Layers, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getPlanPrice, paymentConfig } from "@/config/payment";
import { createCheckoutSession } from "@/features/payment/actions";
import { PlanInterval } from "@/features/payment/types";
import { useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

import { AnimatedPrice } from "./animated-price";

/**
 * 计划配置（用于获取价格等非翻译数据）
 */
const PLAN_IDS = ["free", "starter", "pro", "ultra"] as const;

/**
 * 计划功能 keys（按顺序显示，credits 单独突出显示）
 */
const PLAN_FEATURE_KEYS: Record<string, string[]> = {
  free: [
    "creditsNeverExpire",
    "input",
    "characters",
    "fileSize",
    "export",
    "history",
  ],
  starter: [
    "creditsNeverExpire",
    "input",
    "characters",
    "fileSize",
    "export",
    "history",
    "support",
  ],
  pro: [
    "creditsNeverExpire",
    "input",
    "characters",
    "fileSize",
    "queue",
    "export",
    "history",
    "customCards",
    "support",
  ],
  ultra: [
    "creditsNeverExpire",
    "input",
    "characters",
    "fileSize",
    "queue",
    "export",
    "history",
    "customCards",
    "aiAssist",
    "support",
  ],
};

/**
 * 价格计划组件属性
 */
interface PricingSectionProps {
  /** 用户当前订阅的价格 ID */
  currentPriceId?: string | null;
  /** 当前用户 */
  user?: {
    id: string;
  } | null;
}

/**
 * 价格计划展示组件
 */
export function PricingSection({
  currentPriceId,
  user = null,
}: PricingSectionProps) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const [isYearly, setIsYearly] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { data: session } = useSession();
  const currentUser = user ?? (mounted ? (session?.user ?? null) : null);

  // 首屏先使用服务端用户快照，避免订阅按钮在 hydration 前后切换
  useEffect(() => {
    setMounted(true);
  }, []);

  // 获取用户当前订阅状态
  const activePriceId = currentPriceId ?? null;

  const { yearlyDiscount } = paymentConfig;

  /**
   * 为不同计划提供轻量的按钮区分
   */
  const getPlanButtonClass = (planId: string, popular: boolean) => {
    if (popular) {
      return "bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] text-[#003064] shadow-lg shadow-blue-500/20 hover:opacity-95";
    }
    if (planId === "starter") {
      return "bg-[#123b47] text-[#8ce7ff] shadow-lg shadow-cyan-950/20 hover:bg-[#184b59]";
    }
    if (planId === "ultra") {
      return "bg-[#3f2d14] text-[#ffd48a] shadow-lg shadow-amber-950/20 hover:bg-[#513919]";
    }
    return "bg-white/[0.04] text-[#e1e2eb] hover:bg-white/[0.08]";
  };

  /**
   * 获取计划配置
   */
  const getPlanConfig = (planId: string) => {
    return paymentConfig.plans[planId as keyof typeof paymentConfig.plans];
  };

  /**
   * 获取计划的当前价格
   */
  const getCurrentPrice = (planId: string) => {
    const config = getPlanConfig(planId);
    if (!config || !("prices" in config) || !config.prices) return null;
    const interval = isYearly ? PlanInterval.YEAR : PlanInterval.MONTH;
    return getPlanPrice(
      { ...config, name: "", description: "", features: [], cta: "" },
      interval
    );
  };

  /**
   * 获取显示价格
   */
  const getDisplayPrice = (planId: string): number => {
    if (planId === "free") return 0;
    const price = getCurrentPrice(planId);
    return price?.amount ?? 0;
  };

  /**
   * 获取价格后缀
   */
  const getPriceSuffix = (planId: string): string => {
    if (planId === "free") return "";
    if (locale === "zh") {
      return isYearly ? "/年" : "/月";
    }
    return isYearly ? "/year" : "/month";
  };

  /**
   * 检查是否为当前订阅
   */
  const isCurrentPlan = (planId: string) => {
    if (!activePriceId) return false;
    const config = getPlanConfig(planId);
    if (!config || !("prices" in config) || !config.prices) return false;
    return config.prices.some((p) => p.priceId === activePriceId);
  };

  /**
   * 检查用户是否有活跃订阅（任意计划）
   */
  const hasSubscription = !!activePriceId;

  /**
   * 检查是否为热门计划
   */
  const isPopular = (planId: string) => {
    const config = getPlanConfig(planId);
    return config && "popular" in config && config.popular;
  };

  /**
   * 处理订阅按钮点击
   */
  const handleSubscribe = async (planId: string) => {
    if (planId === "free") {
      router.push(currentUser ? "/dashboard" : "/sign-up");
      return;
    }

    if (!currentUser) {
      router.push("/sign-in?redirect=/#pricing");
      return;
    }

    const price = getCurrentPrice(planId);
    if (!price?.priceId) return;

    setLoadingPlan(planId);

    startTransition(async () => {
      try {
        const result = await createCheckoutSession({
          priceId: price.priceId,
          type: price.type,
        });
        if (result?.data?.url) {
          window.location.href = result.data.url;
        }
      } catch (error) {
        console.error("Failed to create checkout session:", error);
      } finally {
        setLoadingPlan(null);
      }
    });
  };

  /**
   * 处理管理订阅按钮点击 — 跳转到账单设置页
   */
  const handleManageSubscription = () => {
    router.push("/dashboard/settings");
  };

  return (
    <section
      id="pricing"
      className="relative overflow-hidden bg-[#10131a] px-4 py-24 text-[#e1e2eb] sm:px-6 lg:px-8 lg:py-32"
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-[8%] top-[18%] h-72 w-72 rounded-full bg-[#0A84FF]/10 blur-[120px]" />
        <div className="absolute bottom-[8%] right-[10%] h-80 w-80 rounded-full bg-[#5AC8FA]/10 blur-[140px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="mb-14 text-center">
          <h2 className="mb-4 font-['Manrope'] text-4xl font-bold tracking-[-0.05em] md:text-5xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-7 text-[#c0c6d6] md:text-lg">
            {t.rich("subtitle", {
              strong: (chunks) => (
                <strong className="font-semibold text-[#74d1ff]">
                  {chunks}
                </strong>
              ),
            })}
          </p>
        </div>

        <div className="mb-12 flex items-center justify-center gap-4">
          <Label
            htmlFor="billing-toggle"
            className={cn(
              "text-sm font-medium transition-colors",
              !isYearly ? "text-[#e1e2eb]" : "text-[#8b91a0]"
            )}
          >
            {t("monthly")}
          </Label>
          <Switch
            id="billing-toggle"
            checked={isYearly}
            onCheckedChange={setIsYearly}
            className="data-[state=checked]:bg-[#0A84FF]"
          />
          <Label
            htmlFor="billing-toggle"
            className={cn(
              "text-sm font-medium transition-colors",
              isYearly ? "text-[#e1e2eb]" : "text-[#8b91a0]"
            )}
          >
            {t("yearly")}
            <Badge className="ml-2 border-0 bg-[#0A84FF]/15 text-xs text-[#74d1ff] shadow-none">
              {t("save")} {yearlyDiscount}%
            </Badge>
          </Label>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_IDS.map((planId) => {
            const price = getDisplayPrice(planId);
            const isCurrent = isCurrentPlan(planId);
            const isLoading = loadingPlan === planId;
            const popular = isPopular(planId) ?? false;
            const featureKeys = PLAN_FEATURE_KEYS[planId] || [];

            return (
              <article
                key={planId}
                className={cn(
                  "relative flex h-full flex-col rounded-[2rem] border border-white/10 bg-[rgba(29,32,38,0.72)] p-6 pt-8 backdrop-blur-[20px]",
                  popular &&
                    "border-[#149ccb]/40 bg-[linear-gradient(180deg,rgba(20,156,203,0.18),rgba(29,32,38,0.84))] shadow-[0_24px_80px_rgba(10,132,255,0.14)]",
                  isCurrent && "ring-2 ring-[#5AC8FA]/70"
                )}
              >
                {popular && !isCurrent && (
                  <Badge className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full border-0 bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-4 py-1 text-[#003064] shadow-lg shadow-blue-500/20">
                    {t("mostPopular")}
                  </Badge>
                )}
                {isCurrent && (
                  <Badge className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full border-0 bg-emerald-500 px-4 py-1 text-white shadow-lg shadow-emerald-950/20">
                    {t("currentPlan")}
                  </Badge>
                )}

                <div className="mb-6">
                  <p className="mb-2 text-sm uppercase tracking-[0.18em] text-[#74d1ff]">
                    {t(`plans.${planId}.name`)}
                  </p>
                  <h3 className="mb-2 font-['Manrope'] text-3xl font-bold tracking-[-0.04em]">
                    ${<AnimatedPrice value={price} />}
                    {planId !== "free" ? (
                      <span className="ml-2 text-base font-medium text-[#8b91a0]">
                        {getPriceSuffix(planId)}
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-sm leading-6 text-[#c0c6d6]">
                    {t(`plans.${planId}.description`)}
                  </p>
                </div>

                <div className="mb-6 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A84FF]/15 text-[#74d1ff]">
                      <Coins className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-lg font-bold">
                        {planId === "free" ? (
                          t(`plans.${planId}.creditsAmount`)
                        ) : (
                          <AnimatedPrice
                            value={
                              parseInt(
                                t(`plans.${planId}.creditsAmount`).replace(
                                  /,/g,
                                  ""
                                ),
                                10
                              ) * (isYearly ? 12 : 1)
                            }
                            formatOptions={{
                              useGrouping: true,
                              maximumFractionDigits: 0,
                            }}
                          />
                        )}
                      </p>
                      <p className="text-xs text-[#8b91a0]">
                        {planId === "free"
                          ? t(`plans.${planId}.creditsLabel`)
                          : isYearly
                            ? t("creditsPerYear")
                            : t(`plans.${planId}.creditsLabel`)}
                      </p>
                    </div>
                    {planId !== "free" && isYearly ? (
                      <Badge className="ml-auto border-0 bg-[#149ccb]/15 text-[10px] text-[#74d1ff] shadow-none">
                        {t("creditsUpfront")}
                      </Badge>
                    ) : null}
                  </div>

                  {t.has(`plans.${planId}.booksCount`) ? (
                    <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs text-[#8b91a0]">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-[#74d1ff]" />
                        <span>
                          {t("booksNote", {
                            count: String(
                              parseInt(t(`plans.${planId}.booksCount`), 10) *
                                (isYearly ? 12 : 1)
                            ),
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-[#74d1ff]" />
                        <span>
                          {t("cardsNote", {
                            count: (
                              parseInt(t(`plans.${planId}.booksCount`), 10) *
                              300 *
                              (isYearly ? 12 : 1)
                            ).toLocaleString(),
                          })}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {t.has(`plans.${planId}.creditsNote`) ? (
                    <div className="mt-3 text-xs text-[#8b91a0]">
                      {t(`plans.${planId}.creditsNote`)}
                    </div>
                  ) : null}
                </div>

                <ul className="mb-6 flex-1 space-y-3">
                  {featureKeys.map((featureKey) => (
                    <li key={featureKey} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A84FF]/12 text-[#74d1ff]">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="text-sm leading-6 text-[#c0c6d6]">
                        {t(`plans.${planId}.features.${featureKey}`)}
                      </span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <Button
                    className="h-12 w-full rounded-full border-white/10 bg-white/[0.04] text-[#e1e2eb] hover:bg-white/[0.08]"
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t("manageSubscription")}
                  </Button>
                ) : hasSubscription && planId !== "free" ? (
                  <Button
                    className="h-12 w-full rounded-full border-white/10 bg-transparent text-[#8b91a0]"
                    variant="outline"
                    disabled
                  >
                    {t("alreadySubscribed")}
                  </Button>
                ) : (
                  <Button
                    className={cn(
                      "h-12 w-full rounded-full border-0 text-sm font-bold",
                      getPlanButtonClass(planId, popular)
                    )}
                    variant="default"
                    onClick={() => handleSubscribe(planId)}
                    disabled={isLoading || isPending}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t(`plans.${planId}.cta`)}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
