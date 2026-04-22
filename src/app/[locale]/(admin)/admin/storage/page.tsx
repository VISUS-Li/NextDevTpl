import { AdminStorageView } from "@/features/storage/components/admin-storage-view";
import { getStorageAdminPageData } from "@/features/storage/records";

export const metadata = {
  title: "Storage Admin | tripai",
  description: "管理对象存储配置、资源记录与过期清理",
};

/**
 * 管理端对象存储页面
 */
export default async function AdminStoragePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const recentPage = Number(
    Array.isArray(resolvedParams.recentPage)
      ? resolvedParams.recentPage[0]
      : resolvedParams.recentPage
  );
  const recentPageSize = Number(
    Array.isArray(resolvedParams.recentPageSize)
      ? resolvedParams.recentPageSize[0]
      : resolvedParams.recentPageSize
  );
  const data = await getStorageAdminPageData({
    ...(Number.isFinite(recentPage) ? { recentPage } : {}),
    ...(Number.isFinite(recentPageSize) ? { recentPageSize } : {}),
  });

  return <AdminStorageView data={data} />;
}
