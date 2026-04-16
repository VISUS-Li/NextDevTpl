import { redirect } from "next/navigation";

import { DistributionDashboardView } from "@/features/distribution/components/distribution-dashboard-view";
import { getDistributionDashboardData } from "@/features/distribution/queries";
import { getServerSession } from "@/lib/auth/server";

/**
 * 分销中心页面元数据
 */
export const metadata = {
  title: "Distribution | tripai",
  description: "查看推广、佣金和提现状态",
};

/**
 * 用户端分销中心页面
 */
export default async function DistributionDashboardPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?reason=session-expired");
  }

  const data = await getDistributionDashboardData(session.user.id);

  return <DistributionDashboardView data={data} />;
}
