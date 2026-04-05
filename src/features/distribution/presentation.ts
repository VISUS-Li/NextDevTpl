import { siteConfig } from "@/config";

/**
 * 格式化金额
 */
export function formatDistributionAmount(amount: number, currency = "USD") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

/**
 * 格式化时间
 */
export function formatDistributionDate(value: Date | string | null | undefined) {
  if (!value) {
    return "未记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/**
 * 构造推广链接
 */
export function buildReferralLink(code: string, landingPath?: string | null) {
  const url = new URL(landingPath || "/", siteConfig.url);
  url.searchParams.set("ref", code);
  return url.toString();
}

/**
 * 计算可提现占比
 */
export function getAvailableCommissionRatio(params: {
  availableAmount: number;
  totalEarned: number;
}) {
  if (params.totalEarned <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((params.availableAmount / params.totalEarned) * 100))
  );
}

/**
 * 获取订单类型文案
 */
export function getOrderTypeLabel(value: "subscription" | "credit_purchase") {
  return value === "credit_purchase" ? "积分包" : "订阅";
}

/**
 * 获取售后状态文案
 */
export function getAfterSalesLabel(
  value: "none" | "partial_refund" | "refunded" | "returned" | "chargeback"
) {
  const map = {
    none: "正常",
    partial_refund: "部分退款",
    refunded: "已退款",
    returned: "已退货",
    chargeback: "拒付",
  } as const;

  return map[value];
}

/**
 * 获取佣金状态展示
 */
export function getCommissionStatusMeta(
  value: "frozen" | "available" | "reversed" | "withdrawn"
) {
  const map = {
    frozen: { label: "冻结中", variant: "secondary" as const },
    available: { label: "可提现", variant: "default" as const },
    reversed: { label: "已冲正", variant: "destructive" as const },
    withdrawn: { label: "已提现", variant: "outline" as const },
  };

  return map[value];
}

/**
 * 获取提现状态展示
 */
export function getWithdrawalStatusMeta(
  value: "pending" | "approved" | "rejected" | "paid" | "failed"
) {
  const map = {
    pending: { label: "待处理", variant: "secondary" as const },
    approved: { label: "已审核", variant: "outline" as const },
    rejected: { label: "已驳回", variant: "destructive" as const },
    paid: { label: "已打款", variant: "default" as const },
    failed: { label: "打款失败", variant: "destructive" as const },
  };

  return map[value];
}
