"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";

/**
 * 全局 Providers 组件
 *
 * 功能:
 * - 主题管理 (next-themes)
 * - Fumadocs UI 框架支持 (RootProvider)
 * - 可扩展添加其他 Provider (如 QueryClient, SessionProvider 等)
 */

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();
  const content = pathname.includes("/docs") ? (
    // 文档页才需要 Fumadocs Provider，避免影响营销页渲染。
    <RootProvider>{children}</RootProvider>
  ) : (
    children
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {content}
    </ThemeProvider>
  );
}
