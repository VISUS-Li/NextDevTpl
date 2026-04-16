"use client";

import { Grid2x2, House, LifeBuoy, NotebookPen, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { LanguageSwitcher, ModeToggle } from "@/features/shared";
import { Link } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

interface HeaderUser {
  id: string;
  name: string;
  image?: string | null | undefined;
}

interface HeaderProps {
  user?: HeaderUser | null;
}

/**
 * Marketing 页面顶部导航栏
 *
 * 布局: [Logo + Nav 靠左] -------- [Actions 靠右]
 */
export function Header({ user }: HeaderProps) {
  const t = useTranslations("Header");
  const locale = useLocale();
  const pathname = usePathname();
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();
  const currentUser = user ?? (mounted ? (session?.user ?? null) : null);

  // 首屏只使用服务端快照，避免客户端 session 改变导航节点数量
  useEffect(() => {
    setMounted(true);
  }, []);

  // 桌面端导航项
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
      key: "pseo",
      href: "/pseo",
      label: "PSEO",
    },
    ...(currentUser
      ? [
          {
            key: "support",
            href: "/dashboard/support",
            label: locale === "zh" ? "我的工单" : "Support",
          },
        ]
      : []),
  ];

  // 移动端底部导航项
  const mobileNavItems = [
    {
      key: "home",
      href: "/",
      label: locale === "zh" ? "首页" : "Home",
      icon: House,
    },
    {
      key: "tools",
      href: "/#features",
      label: locale === "zh" ? "工具" : "Tools",
      icon: Grid2x2,
    },
    {
      key: "account",
      href: currentUser ? "/dashboard" : "/sign-in",
      label: locale === "zh" ? "我的" : "My",
      icon: UserRound,
    },
  ];

  // 移动端补充快捷入口，补齐首页能到达的真实页面
  const mobileQuickLinks = [
    {
      key: "tools",
      href: "/#features",
      label: locale === "zh" ? "工具" : "Tools",
      icon: Grid2x2,
    },
    {
      key: "pricing",
      href: "/#pricing",
      label: locale === "zh" ? "方案" : "Plans",
      icon: NotebookPen,
    },
    {
      key: "pseo",
      href: "/pseo",
      label: "PSEO",
      icon: Grid2x2,
    },
    ...(currentUser
      ? [
          {
            key: "support",
            href: "/dashboard/support",
            label: locale === "zh" ? "工单" : "Support",
            icon: LifeBuoy,
          },
        ]
      : []),
  ];

  /**
   * 处理首页锚点跳转
   */
  const handleNavClick = (href: string) => {
    if (!href.startsWith("/#")) return;
    const anchor = href.slice(2);
    const isHomePage = /^\/[a-z]{2}$/.test(pathname);
    if (!isHomePage) return;
    setActiveSection(anchor);
    const section = document.getElementById(anchor);
    if (section) {
      section.scrollIntoView({ behavior: "smooth" });
    }
  };

  /**
   * 根据当前滚动区块同步底部导航激活态
   */
  useEffect(() => {
    const isHomePage = /^\/[a-z]{2}$/.test(pathname);
    if (!isHomePage) {
      setActiveSection(null);
      return;
    }

    const trackedSections = ["features", "pricing"];
    const updateActiveSection = () => {
      if (window.scrollY < 120) {
        setActiveSection(null);
        return;
      }

      let nextSection: string | null = null;
      for (const sectionId of trackedSections) {
        const section = document.getElementById(sectionId);
        if (!section) continue;
        if (window.scrollY + 180 >= section.offsetTop) {
          nextSection = sectionId;
        }
      }
      setActiveSection(nextSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("hashchange", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("hashchange", updateActiveSection);
    };
  }, [pathname]);

  /**
   * 判断导航项是否处于当前页面
   */
  const isNavItemActive = (href: string) => {
    if (href.startsWith("/#")) {
      return /^\/[a-z]{2}$/.test(pathname) && activeSection === href.slice(2);
    }
    if (href === "/") {
      return pathname === `/${locale}` && activeSection === null;
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
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#10131a]/70 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        <div className="mx-auto hidden h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 md:flex lg:px-8">
          {/* 左侧 - Logo + 导航菜单 */}
          <div className="flex items-center gap-6 lg:gap-12">
            <Link
              href="/"
              className="bg-gradient-to-br from-[#0A84FF] to-[#5AC8FA] bg-clip-text font-['Manrope'] text-xl font-extrabold tracking-[-0.04em] text-transparent"
            >
              <span className="hidden sm:inline">tripai</span>
              <span className="sm:hidden">tripai</span>
            </Link>

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

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <ModeToggle />
            {currentUser ? (
              <>
                <Link
                  href="/dashboard"
                  className={buttonVariants({
                    variant: "ghost",
                    className:
                      "hidden h-10 rounded-full px-5 text-[#e1e2eb]/70 hover:bg-white/5 hover:text-[#e1e2eb] md:inline-flex",
                  })}
                >
                  {t("dashboard")}
                </Link>
                <Link href="/dashboard" className="hidden md:block">
                  <Avatar className="h-9 w-9 ring-1 ring-white/10">
                    <AvatarImage
                      src={currentUser.image || undefined}
                      alt={currentUser.name}
                    />
                    <AvatarFallback className="bg-[#0A84FF] text-xs text-white">
                      {getInitials(currentUser.name)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className={buttonVariants({
                    variant: "ghost",
                    className:
                      "hidden h-10 rounded-full px-5 text-[#e1e2eb]/70 hover:bg-white/5 hover:text-[#e1e2eb] md:inline-flex",
                  })}
                >
                  {t("login")}
                </Link>
                <Link
                  href="/sign-up"
                  className={buttonVariants({
                    className:
                      "hidden h-11 rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-6 text-sm font-bold text-[#003064] shadow-lg shadow-blue-500/20 transition-transform hover:scale-105 hover:shadow-blue-500/30 md:inline-flex",
                  })}
                >
                  {t("getStarted")}
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6 md:hidden">
          <Link
            href="/"
            className="bg-gradient-to-br from-[#0A84FF] to-[#5AC8FA] bg-clip-text font-['Manrope'] text-xl font-extrabold tracking-[-0.04em] text-transparent"
          >
            tripai
          </Link>

          <div className="flex items-center gap-2">
            {currentUser ? (
              <Link
                href="/dashboard"
                className={buttonVariants({
                  className:
                    "h-10 rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-5 text-sm font-bold text-[#003064]",
                })}
              >
                {t("dashboard")}
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className={buttonVariants({
                    variant: "ghost",
                    className:
                      "h-10 rounded-full px-4 text-sm font-bold text-[#e1e2eb]/72 hover:bg-white/5 hover:text-[#e1e2eb]",
                  })}
                >
                  {t("login")}
                </Link>
                <Link
                  href="/sign-up"
                  className={buttonVariants({
                    className:
                      "h-10 rounded-full bg-[linear-gradient(135deg,#0A84FF_0%,#5AC8FA_100%)] px-5 text-sm font-bold text-[#003064]",
                  })}
                >
                  {t("getStarted")}
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-2 overflow-x-auto border-t border-white/5 px-4 pb-2 md:hidden">
          {mobileQuickLinks.map((item) => {
            const Icon = item.icon;
            const isActive = isNavItemActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => handleNavClick(item.href)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                  isActive
                    ? "border-[#0A84FF]/30 bg-[#0A84FF]/15 text-[#74d1ff]"
                    : "border-white/8 bg-white/[0.04] text-[#e1e2eb]/62"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </header>

      <nav className="fixed bottom-6 left-1/2 z-[60] flex h-20 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-around rounded-full border border-white/10 bg-[rgba(29,32,38,0.82)] px-5 text-[#e1e2eb] shadow-2xl backdrop-blur-[20px] md:hidden">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = isNavItemActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => handleNavClick(item.href)}
              className="flex min-w-14 flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                  isActive
                    ? "bg-[#0A84FF]/18 text-[#74d1ff] shadow-[0_0_0_1px_rgba(116,209,255,0.2)]"
                    : "text-[#e1e2eb]/50"
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span
                className={cn(
                  "text-[10px] font-bold tracking-wide transition-colors",
                  isActive ? "text-[#74d1ff]" : "text-[#e1e2eb]/50"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
