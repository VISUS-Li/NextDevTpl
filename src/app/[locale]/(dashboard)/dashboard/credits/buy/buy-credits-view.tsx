"use client";

/**
 * 购买积分套餐视图组件
 *
 * 显示积分套餐列表，允许用户选择并购买
 */

import { Check, Coins, Loader2, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { createCreditsPurchaseCheckout } from "@/features/credits/actions";
import { CREDIT_PACKAGES } from "@/features/credits/config";
import { PaymentProvider } from "@/features/payment/types";
import { cn } from "@/lib/utils";

/**
 * 购买积分套餐视图
 */
export function BuyCreditPackagesView() {
  const router = useRouter();
  const t = useTranslations("DashboardCreditsBuy");
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled");
  const [provider, setProvider] = useState(PaymentProvider.CREEM);

  // 创建积分购买支付单。
  const { execute, isPending } = useAction(createCreditsPurchaseCheckout, {
    onSuccess: ({ data }) => {
      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? t("toasts.checkoutFailed"));
    },
  });

  // 显示取消提示
  useEffect(() => {
    if (canceled) {
      toast.info(t("toasts.canceled"));
      // 清除 URL 参数
      router.replace("/dashboard/credits/buy");
    }
  }, [canceled, router, t]);

  /**
   * 处理购买按钮点击
   */
  const handlePurchase = (packageId: "starter" | "standard" | "premium") => {
    execute({ packageId, provider });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 页面标题 */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">{t("provider.title")}</CardTitle>
          <CardDescription>{t("provider.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {[
            {
              key: PaymentProvider.CREEM,
              label: t("provider.options.creem"),
              description: t("provider.hints.creem"),
            },
            {
              key: PaymentProvider.WECHAT_PAY,
              label: t("provider.options.wechat"),
              description: t("provider.hints.wechat"),
            },
            {
              key: PaymentProvider.ALIPAY,
              label: t("provider.options.alipay"),
              description: t("provider.hints.alipay"),
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                provider === item.key
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50"
              )}
              onClick={() => setProvider(item.key)}
            >
              <p className="font-medium">{item.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.description}
              </p>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* 套餐列表 */}
      <div className="grid gap-6 md:grid-cols-3">
        {CREDIT_PACKAGES.map((pkg) => {
          const isPopular = "popular" in pkg && pkg.popular;

          return (
            <Card
              key={pkg.id}
              className={cn(
                "relative flex flex-col",
                isPopular && "border-primary shadow-lg"
              )}
            >
              {/* 热门标签 */}
              {isPopular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1">
                  <Sparkles className="h-3 w-3" />
                  {t("popular")}
                </Badge>
              )}

              <CardHeader className="text-center pb-4">
                <CardTitle className="text-xl">{pkg.name}</CardTitle>
                <CardDescription>{pkg.description}</CardDescription>
              </CardHeader>

              <CardContent className="flex-1 space-y-4">
                {/* 积分数量 */}
                <div className="flex items-center justify-center gap-2">
                  <Coins className="h-6 w-6 text-amber-500" />
                  <span className="text-4xl font-bold">{pkg.credits}</span>
                  <span className="text-muted-foreground">
                    {t("creditsUnit")}
                  </span>
                </div>

                <Separator />

                {/* 价格 */}
                <div className="text-center">
                  <span className="text-3xl font-bold">${pkg.price}</span>
                  <span className="text-muted-foreground"> USD</span>
                </div>

                {/* 特性列表 */}
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" />
                    <span>{t("features.instant")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" />
                    <span>{t("features.validity")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" />
                    <span>{t("features.usage")}</span>
                  </li>
                </ul>
              </CardContent>

              <CardFooter>
                <Button
                  className="w-full"
                  variant={isPopular ? "default" : "outline"}
                  disabled={isPending}
                  onClick={() =>
                    handlePurchase(pkg.id as "starter" | "standard" | "premium")
                  }
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("processing")}
                    </>
                  ) : (
                    t("buy", { name: pkg.name })
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* 返回链接 */}
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard/settings?tab=usage")}
        >
          {t("back")}
        </Button>
      </div>
    </div>
  );
}
