import { AdminDistributionView } from "@/features/distribution/components/admin-distribution-view";
import { getAdminDistributionOverview } from "@/features/distribution/queries";

/**
 * 管理端分销页面元数据
 */
export const metadata = {
  title: "Distribution Admin | tripai",
  description: "管理分销、佣金与提现审核",
};

/**
 * 管理端分销页面
 */
export default async function AdminDistributionPage() {
  const data = await getAdminDistributionOverview();

  return <AdminDistributionView data={data} />;
}
