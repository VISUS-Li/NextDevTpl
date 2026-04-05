"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LanguageSwitcher, ModeToggle } from "@/features/shared";
import { Link } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";

/**
 * Marketing 页面顶部导航栏
 *
 * 布局: [Logo + Nav 靠左] -------- [Actions 靠右]
 */
export function Header() {
  // 获取当前用户会话状态
  const { data: session, isPending } = useSession();
  const user = session?.user;
  const t = useTranslations("Header");
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // 首页导航项
  const navItems = [
    {
      key: "products",
      href: "/#features",
      label: locale === "zh" ? "产品工具" : "Tools",
    },
    {
      key: "pricing",
      href: "/#pricing",
      label: locale === "zh" ? "订阅方案" : "Plans",
    },
    {
      key: "docs",
      href: "/docs",
      label: locale === "zh" ? "开发文档" : "Docs",
    },
  ];

  /**
   * 处理首页锚点跳转
   */
  const handleNavClick = (href: string) => {
    if (!href.startsWith("/#")) return;
    const anchor = href.slice(2);
    const isHomePage = /^\/[a-z]{2}$/.test(pathname);
    if (!isHomePage) return;
    const section = document.getElementById(anchor);
    if (section) {
      section.scrollIntoView({ behavior: "smooth" });
    }
  };

  /**
   * 判断导航项是否处于当前页面
   */
  const isNavItemActive = (href: string) => {
    if (href === "/docs") {
      return pathname.startsWith(`/${locale}/docs`);
    }
    if (href.startsWith("/#")) {
      return /^\/[a-z]{2}$/.test(pathname);
    }
    return (
      pathname === `/${locale}${href}` ||
      pathname.startsWith(`/${locale}${href}/`)
    );
  };

  /**
   * 获取用户名首字母作为头像回退
   */
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#10131a]/70 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* 左侧 - Logo + 导航菜单 */}
        <div className="flex items-center gap-6 lg:gap-12">
          {/* Logo */}
          <Link
            href="/"
            className="bg-gradient-to-br from-[#0A84FF] to-[#5AC8FA] bg-clip-text font-['Manrope'] text-xl font-extrabold tracking-[-0.04em] text-transparent"
          >
            <span className="hidden sm:inline">
              {locale === "zh" ? "Trip 旅行者 AI" : "Trip Traveler AI"}
            </span>
            <span className="sm:hidden">Trip AI</span>
          </Link>

          {/* 桌面端导航 */}
          <nav className="hidden items-center gap-8 font-['Manrope'] text-sm font-bold tracking-tight md:flex">
            {navItems.map((item) => {
              const isActive = isNavItemActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => handleNavClick(item.href)}
                  className={
                    isActive
                      ? "border-b-2 border-[#0A84FF] pb-1 text-[#0A84FF]"
                      : "text-[#e1e2eb]/70 transition-colors hover:text-[#e1e2eb]"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 右侧 - 操作区域 */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* 语言切换 */}
          <LanguageSwitcher />

          {/* 主题切换 */}
          <ModeToggle />

          {isPending ? (
            // 加载状态 - 显示骨架
            <div className="hidden h-9 w-24 animate-pulse rounded-md bg-muted md:block" />
          ) : user ? (
            // 已登录 - 显示 Dashboard 按钮和头像
            <>
              <Button
                asChild
                variant="ghost"
                className="hidden h-10 rounded-full px-5 text-[#e1e2eb]/70 hover:bg-white/5 hover:text-[#e1e2eb] md:inline-flex"
              >
                <Link href="/dashboard">{t("dashboard")}</Link>
              </Button>
              <Link href="/dashboard" className="hidden md:block">
                <Avatar className="h-9 w-9 ring-1 ring-white/10">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-[#0A84FF] text-xs text-white">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </Link>
            </>
          ) : (
            // 未登录 - 显示登录和注册按钮（桌面端）
            <>
              <Button
                asChild
                variant="ghost"
                className="hidden h-10 rounded-full px-5 text-[#e1e2eb]/70 hover:bg-white/5 hover:text-[#e1e2eb] md:inline-flex"
              >
                <Link href="/sign-in">{t("login")}</Link>
              </Button>
              <Button
                asChild
                className="hidden h-11 rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-6 text-sm font-bold text-[#003064] shadow-lg shadow-blue-500/20 transition-transform hover:scale-105 hover:shadow-blue-500/30 md:inline-flex"
              >
                <Link href="/sign-up">{t("getStarted")}</Link>
              </Button>
            </>
          )}

          {/* 移动端汉堡按钮 */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#e1e2eb]/80 transition-colors hover:bg-white/5 hover:text-[#e1e2eb] md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 移动端导航 Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          className="w-[min(88vw,22rem)] border-white/10 bg-[#10131a] p-0 text-[#e1e2eb] md:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-full flex-col">
            <div className="border-b border-white/10 px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A84FF]/15 text-[#74d1ff]">
                  <Menu className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-['Manrope'] text-sm font-semibold">
                    {locale === "zh" ? "Trip 旅行者 AI" : "Trip Traveler AI"}
                  </p>
                  <p className="text-xs text-[#e1e2eb]/55">
                    {locale === "zh" ? "创作工具入口" : "Creator toolkit"}
                  </p>
                </div>
              </div>
            </div>
            {/* 导航链接 */}
            <nav className="flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-2">
                {navItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => {
                      setMobileOpen(false);
                      handleNavClick(item.href);
                    }}
                    className="flex min-h-11 items-center rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 font-['Manrope'] text-sm font-semibold text-[#e1e2eb]/78 transition-colors hover:bg-white/[0.08] hover:text-[#e1e2eb]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <div className="mt-6 rounded-3xl border border-white/8 bg-white/[0.03] p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[#74d1ff]">
                  {locale === "zh" ? "定位" : "Positioning"}
                </p>
                <p className="text-sm leading-6 text-[#e1e2eb]/70">
                  {locale === "zh"
                    ? "专业级 AI 创作工具集，覆盖文案、视频与 3D 生产流程。"
                    : "Professional AI creation tools for copy, video, and 3D production."}
                </p>
              </div>
            </nav>

            {/* 底部操作按钮 */}
            <div className="space-y-2 border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {user ? (
                <Button
                  asChild
                  className="h-11 w-full rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] text-[#003064]"
                >
                  <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                    {t("dashboard")}
                  </Link>
                </Button>
              ) : (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    className="h-11 w-full rounded-full border border-white/10 text-[#e1e2eb] hover:bg-white/[0.06] hover:text-[#e1e2eb]"
                  >
                    <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                      {t("login")}
                    </Link>
                  </Button>
                  <Button
                    asChild
                    className="h-11 w-full rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] text-[#003064]"
                  >
                    <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                      {t("getStarted")}
                    </Link>
                  </Button>
                </>
              )}

              <Button
                asChild
                variant="outline"
                className="h-11 w-full rounded-full border-white/10 bg-transparent text-[#e1e2eb] hover:bg-white/[0.06] hover:text-[#e1e2eb]"
              >
                <Link href="/docs" onClick={() => setMobileOpen(false)}>
                  {locale === "zh" ? "查看文档" : "Read Docs"}
                </Link>
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
