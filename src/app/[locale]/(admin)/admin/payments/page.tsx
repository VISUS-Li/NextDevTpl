import { getAdminPaymentPageData } from "@/features/payment/admin";
import { AdminPaymentView } from "@/features/payment/components/admin-payment-view";

export const metadata = {
  title: "Payments Admin | tripai",
  description: "管理支付订单、支付状态与售后记录",
};

/**
 * 管理端支付中心页面。
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const getValue = (key: string) => {
    const value = resolvedParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Number(getValue("page"));
  const pageSize = Number(getValue("pageSize"));
  const query = getValue("query");
  const provider = getValue("provider");
  const orderType = getValue("orderType");
  const paymentState = getValue("paymentState");
  const orderId = getValue("orderId");

  const data = await getAdminPaymentPageData({
    ...(Number.isFinite(page) ? { page } : {}),
    ...(Number.isFinite(pageSize) ? { pageSize } : {}),
    ...(query ? { query } : {}),
    ...(provider
      ? { provider: provider as "creem" | "wechat_pay" | "alipay" }
      : {}),
    ...(orderType
      ? { orderType: orderType as "subscription" | "credit_purchase" }
      : {}),
    ...(paymentState
      ? {
          paymentState: paymentState as
            | "paid"
            | "confirmed"
            | "closed"
            | "partial_refund"
            | "refunded",
        }
      : {}),
    ...(orderId ? { orderId } : {}),
  });

  return <AdminPaymentView data={data} />;
}
