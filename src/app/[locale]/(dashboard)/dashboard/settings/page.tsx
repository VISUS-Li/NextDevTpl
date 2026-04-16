import { redirect } from "next/navigation";
import { SettingsProfileView } from "@/features/settings/components";
import { getUserToolConfigPageData } from "@/features/tool-config/service";
import { getServerSession } from "@/lib/auth/server";

const settingsTabs = [
  "account",
  "security",
  "billing",
  "usage",
  "tools",
] as const;

type SettingsTab = (typeof settingsTabs)[number];

/**
 * 设置页面元数据
 */
export const metadata = {
  title: "Settings | tripai",
  description: "管理您的账户设置和偏好",
};

/**
 * 用户设置页面
 *
 * Server Component - 在服务端获取用户数据
 * 将数据传递给客户端 SettingsProfileView 组件
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  // 获取当前用户会话
  const session = await getServerSession();

  // 如果用户未登录，重定向到登录页
  if (!session || !session.user) {
    redirect("/sign-in?reason=session-expired");
  }

  // 读取当前标签页，非法值回退到 account
  const { tab } = (await searchParams) ?? {};
  const initialTab = settingsTabs.includes(tab as SettingsTab)
    ? (tab as SettingsTab)
    : "account";
  const toolConfigData = await getUserToolConfigPageData({
    userId: session.user.id,
  });

  return (
    <SettingsProfileView
      initialTab={initialTab}
      toolConfigData={toolConfigData}
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        image: session.user.image,
      }}
    />
  );
}
