import { AdminStorageView } from "@/features/storage/components/admin-storage-view";
import { getStorageAdminPageData } from "@/features/storage/records";

export const metadata = {
  title: "Storage Admin | Trip",
  description: "管理对象存储配置、资源记录与过期清理",
};

/**
 * 管理端对象存储页面
 */
export default async function AdminStoragePage() {
  const data = await getStorageAdminPageData();

  return <AdminStorageView data={data} />;
}
