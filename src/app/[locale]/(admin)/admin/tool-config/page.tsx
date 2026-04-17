import { AdminToolConfigView } from "@/features/tool-config/components/admin-tool-config-view";
import { listAdminToolDefinitions } from "@/features/tool-config/definition-admin";
import { getAdminToolConfigPageData } from "@/features/tool-config/service";

export const metadata = {
  title: "Tool Config | tripai",
  description: "管理项目工具配置",
};

/**
 * 管理员工具配置页面
 */
export default async function AdminToolConfigPage() {
  const [data, toolDefinitions] = await Promise.all([
    getAdminToolConfigPageData(),
    listAdminToolDefinitions(),
  ]);

  return <AdminToolConfigView data={data} toolDefinitions={toolDefinitions} />;
}
