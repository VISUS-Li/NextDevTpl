import { AdminSidebar } from "@/features/admin/components";
import { checkAdmin } from "@/lib/auth/admin";

/**
 * Admin 布局组件
 *
 * 功能:
 * - RBAC 权限检查 (只有 admin 角色可访问)
 * - Admin 专用侧边栏
 * - 深色主题背景以区别于普通 Dashboard
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 权限检查 - 非管理员会被重定向
  await checkAdmin();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AdminSidebar />
      <div className="md:pl-64">
        {/* Admin 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-white/80 px-4 pl-16 backdrop-blur dark:bg-slate-900/80 md:px-6 md:pl-6">
          <h1 className="text-lg font-semibold">管理后台</h1>
        </header>
        {/* 主内容区域 */}
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
