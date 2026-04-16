"use client";

import { Globe } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * 支持的语言配置
 */
const locales = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
] as const;

/**
 * 语言切换器组件
 *
 * 功能:
 * - 显示当前语言
 * - 下拉菜单切换语言
 * - 切换时保持当前路径
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("Shared.language");
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  // 首屏先渲染稳定占位，避免服务端和客户端的 Radix id 序列错位
  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * 切换语言
   */
  const handleLocaleChange = (newLocale: string) => {
    startTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript will validate that only known `params`
        // are used in combination with a given `pathname`. Since the two will
        // always match for the current route, we can skip runtime checks.
        { pathname, params },
        { locale: newLocale }
      );
    });
  };

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        title={t("label")}
        className="relative inline-flex size-9 items-center justify-center rounded-md opacity-50"
      >
        <Globe className="h-5 w-5" />
        <span className="sr-only">{t("label")}</span>
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        title={t("label")}
        className={cn(
          "relative inline-flex size-9 items-center justify-center rounded-md transition-all outline-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          isPending && "pointer-events-none opacity-50"
        )}
      >
        {/* 直接渲染触发器，避免 asChild 对单子节点的限制 */}
        <span className="contents">
          <Globe className="h-5 w-5" />
          <span className="sr-only">{t("label")}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc.code}
            onClick={() => handleLocaleChange(loc.code)}
            className={locale === loc.code ? "bg-accent" : ""}
          >
            <span className="mr-2">{loc.flag}</span>
            {loc.code === "en" ? t("english") : t("chinese")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
