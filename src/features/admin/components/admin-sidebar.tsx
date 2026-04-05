"use client";

import {
  ArrowLeft,
  ChevronsUpDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { adminConfig, siteConfig } from "@/config";
import { signOut, useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * 主题类型
 */
type Theme = "light" | "dark" | "system";

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

  // 获取当前用户会话
  const { data: session } = useSession();
  const user = session?.user;

  // 主题状态 (简化版，实际应使用 next-themes)
  const [theme, setTheme] = useState<Theme>("system");

  // Popover 开关状态
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <>
      {/* Logo - Admin 标识 */}
      <div className="flex h-14 items-center border-b border-slate-700 px-4">
        <Link
          href="/admin"
          className="flex items-center gap-2 text-lg font-bold tracking-tight"
          onClick={() => mobile && setMobileOpen(false)}
        >
          <svg
            className="h-6 w-6 shrink-0 text-blue-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>管理后台</title>
            <rect x="5" y="2" width="14" height="17" rx="2" opacity="0.35" />
            <rect x="3" y="5" width="14" height="17" rx="2" />
            <path d="M7 18l3-8 3 8" />
            <path d="M8 16h4" />
          </svg>
          <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
            ADMIN
          </span>
          {siteConfig.name}
        </Link>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 space-y-6 overflow-y-auto p-4">
        {adminConfig.sidebarNav.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              {group.title}
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
                        ? "bg-slate-800 text-white"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}
                    {item.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* 返回用户端链接 */}
        <div className="border-t border-slate-700 pt-4">
          <Link
            href="/dashboard"
            onClick={() => mobile && setMobileOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            返回用户端
          </Link>
        </div>
      </nav>

      {/* 用户信息区域 */}
      <div className="border-t border-slate-700 p-4">
        {user ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-slate-800"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-red-600 text-white text-xs">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 truncate text-left">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-white">
                      {user.name}
                    </p>
                    <span className="rounded bg-red-600/20 px-1.5 py-0.5 text-xs font-medium text-red-400">
                      Admin
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {user.email}
                  </p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
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
                  <AvatarFallback className="bg-red-600 text-white">
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

              {/* 主题切换 */}
              <div className="flex items-center justify-center gap-1 p-3">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    theme === "light"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title="浅色模式"
                >
                  <Sun className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    theme === "dark"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title="深色模式"
                >
                  <Moon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    theme === "system"
                      ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title="跟随系统"
                >
                  <Monitor className="h-4 w-4" />
                </button>
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
                  退出登录
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="h-8 w-8 animate-pulse rounded-full bg-slate-700" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-20 animate-pulse rounded bg-slate-700" />
              <div className="h-3 w-32 animate-pulse rounded bg-slate-700" />
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* 移动端菜单按钮 */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-2.5 z-50 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white text-slate-900 shadow-sm md:hidden dark:bg-slate-900 dark:text-slate-100"
      >
        <Menu className="h-4 w-4" />
        <span className="sr-only">打开管理后台菜单</span>
      </button>

      {/* 桌面端侧边栏 */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r bg-slate-900 text-slate-100 md:flex">
        {renderSidebarContent(false)}
      </aside>

      {/* 移动端抽屉 */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[88vw] max-w-xs border-r-0 bg-slate-900 p-0 text-slate-100"
        >
          <SheetTitle className="sr-only">管理后台菜单</SheetTitle>
          <div className="flex h-full flex-col">
            {renderSidebarContent(true)}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
