import { redirect } from "next/navigation";

import { AutoRenewContractsView } from "@/features/payment/components/auto-renew-contracts-view";
import { listUserSubscriptionContracts } from "@/features/payment/subscription-recurring";
import { getServerSession } from "@/lib/auth/server";

export const metadata = {
  title: "Auto Renew | tripai",
  description: "管理微信连续扣费与支付宝代扣订阅",
};

/**
 * 用户侧自动续费页面。
 */
export default async function AutoRenewPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/sign-in");
  }

  const contracts = await listUserSubscriptionContracts(session.user.id);

  return (
    <AutoRenewContractsView
      contracts={contracts}
      mockMode={process.env.PAYMENT_MOCK_MODE === "true"}
    />
  );
}
