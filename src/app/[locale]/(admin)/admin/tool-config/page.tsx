import { AdminToolConfigView } from "@/features/tool-config/components/admin-tool-config-view";
import { getAdminToolConfigPageData } from "@/features/tool-config/service";

export const metadata = {
  title: "Tool Config | Trip",
  description: "管理项目工具配置",
};

/**
 * 管理员工具配置页面
 */
export default async function AdminToolConfigPage() {
  const data = await getAdminToolConfigPageData();

  return <AdminToolConfigView data={data} />;
}
