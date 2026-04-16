"use client";

import { ArrowLeft, ChevronsUpDown, LogOut, Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { adminConfig, siteConfig } from "@/config";
import { LanguageSwitcher, ModeToggle } from "@/features/shared/components";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { signOut, useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * Admin 侧边栏组件
 *
 * 功能:
 * - Admin 专用导航菜单 (从配置读取)
 * - 用户信息弹出菜单
 * - 主题切换
 * - 返回用户端入口
 * - 登出功能
 *
 * 样式:
 * - 使用深色背景以区别于普通 Dashboard
 */
export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("Admin");

  // 获取当前用户会话
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const user = mounted ? session?.user : undefined;

  // Popover 开关状态
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // 首屏保持和服务端一致，避免 session 返回后重排 Radix 组件树
  useEffect(() => {
    setMounted(true);
  }, []);

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

  /**
   * 处理登出
   */
  const handleSignOut = async () => {
    setOpen(false);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
    setMobileOpen(false);
  };

  /**
   * 去掉 locale 前缀后判断当前路由
   */
  const normalizedPath = pathname.replace(/^\/[a-z]{2}\//, "/");

  /**
   * 渲染桌面端和移动端共用的导航内容
   */
  const renderSidebarContent = (mobile: boolean) => (
    <div
      className={cn(
        "flex h-full flex-col",
        mobile &&
          "grid min-h-0 h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      )}
    >
      {/* Logo - Admin 标识 */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border px-4",
          mobile && "pt-[env(safe-area-inset-top)]"
        )}
      >
        <Link
          href="/admin"
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground"
          onClick={() => mobile && setMobileOpen(false)}
        >
          <svg
            className="h-6 w-6 shrink-0 text-primary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>{t("header.title")}</title>
            <rect x="5" y="2" width="14" height="17" rx="2" opacity="0.35" />
            <rect x="3" y="5" width="14" height="17" rx="2" />
            <path d="M7 18l3-8 3 8" />
            <path d="M8 16h4" />
          </svg>
          <span className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            {t("header.badge")}
          </span>
          {siteConfig.name}
        </Link>
      </div>

      {/* 导航菜单 */}
      <nav
        className={cn(
          "flex-1 space-y-6 overflow-y-auto p-4",
          mobile && "min-h-0 overscroll-contain pb-4"
        )}
      >
        {adminConfig.sidebarNav.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.titleKey ? t(group.titleKey) : group.title}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive =
                  normalizedPath === item.href ||
                  (item.href !== "/admin" &&
                    normalizedPath.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => mobile && setMobileOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}
                    {item.titleKey ? t(item.titleKey) : item.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* 返回用户端链接 */}
        <div className="border-t border-border pt-4">
          <Link
            href="/dashboard"
            onClick={() => mobile && setMobileOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {t("sidebar.backToDashboard")}
          </Link>
        </div>
      </nav>

      {/* 用户信息区域 */}
      <div
        className={cn(
          "shrink-0 border-t border-border p-4",
          mobile && "pb-[env(safe-area-inset-bottom)]"
        )}
      >
        {user ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 truncate text-left">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {user.name}
                    </p>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                      {t("header.badge")}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>

            <PopoverContent
              side={mobile ? "bottom" : "top"}
              align="start"
              sideOffset={8}
              className="w-64 p-0"
            >
              {/* 用户信息头部 */}
              <div className="flex items-center gap-3 p-4">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 truncate">
                  <p className="font-medium">{user.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </div>

              <Separator />

              {/* 语言与主题切换 */}
              <div className="flex items-center justify-center gap-2 p-3">
                <LanguageSwitcher />
                <ModeToggle variant="inline" />
              </div>

              <Separator />

              {/* 菜单项 */}
              <div className="p-2">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <LogOut className="h-4 w-4" />
                  {t("sidebar.logout")}
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* 移动端菜单按钮 */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-2.5 z-50 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground shadow-sm md:hidden"
      >
        <Menu className="h-4 w-4" />
        <span className="sr-only">{t("sidebar.openMenu")}</span>
      </button>

      {/* 桌面端侧边栏 */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r bg-background md:flex">
        {renderSidebarContent(false)}
      </aside>

      {/* 移动端抽屉 */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="flex h-svh max-h-svh w-[88vw] max-w-xs flex-col overflow-hidden border-r-0 bg-background p-0"
        >
          <SheetTitle className="sr-only">{t("sidebar.openMenu")}</SheetTitle>
          <div className="min-h-0 flex-1">{renderSidebarContent(true)}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
