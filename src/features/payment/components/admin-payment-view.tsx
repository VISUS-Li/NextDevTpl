"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { getAdminPaymentPageData } from "@/features/payment/admin";

type AdminPaymentPageData = Awaited<ReturnType<typeof getAdminPaymentPageData>>;

type AdminPaymentViewProps = {
  data: AdminPaymentPageData;
};

/**
 * 管理员支付中心页面。
 */
export function AdminPaymentView({ data }: AdminPaymentViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detail = data.detail;
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("人工退款");
  const [refundLoading, setRefundLoading] = useState(false);
  const [syncContractLoading, setSyncContractLoading] = useState(false);
  const [syncBillingLoading, setSyncBillingLoading] = useState(false);
  const [retryBillingLoading, setRetryBillingLoading] = useState(false);
  const [filters, setFilters] = useState({
    query: data.list.filters.query,
    provider: data.list.filters.provider,
    orderType: data.list.filters.orderType,
    paymentState: data.list.filters.paymentState,
  });

  /**
   * 应用筛选条件。
   */
  const applyFilters = () => {
    const next = new URLSearchParams(searchParams.toString());
    syncParam(next, "query", filters.query);
    syncParam(
      next,
      "provider",
      filters.provider === "all" ? "" : filters.provider
    );
    syncParam(
      next,
      "orderType",
      filters.orderType === "all" ? "" : filters.orderType
    );
    syncParam(
      next,
      "paymentState",
      filters.paymentState === "all" ? "" : filters.paymentState
    );
    next.set("page", "1");
    router.push(`${pathname}?${next.toString()}`);
  };

  /**
   * 切换详情。
   */
  const openDetail = (orderId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("orderId", orderId);
    router.push(`${pathname}?${next.toString()}`);
  };

  /**
   * 切换分页。
   */
  const jumpPage = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    router.push(`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    if (!detail?.items[0]) {
      setRefundAmount("");
      return;
    }
    setRefundAmount(String(detail.items[0].refundableAmount));
  }, [detail?.items]);

  /**
   * 发起退款。
   */
  const submitRefund = async () => {
    if (!detail?.items[0]) {
      return;
    }
    setRefundLoading(true);
    const response = await fetch("/api/platform/payments/admin/refund", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: detail.order.id,
        amount: Number(refundAmount),
        reason: refundReason,
      }),
    });
    const payload = await response.json();
    setRefundLoading(false);

    if (!response.ok || !payload.success) {
      toast.error(payload.message ?? "退款失败");
      return;
    }

    toast.success("退款已提交");
    router.refresh();
  };

  /**
   * 管理员同步协议状态。
   */
  const syncRecurringContract = async () => {
    if (!detail?.recurringContract) {
      return;
    }
    setSyncContractLoading(true);
    const response = await fetch(
      `/api/platform/payments/admin/subscriptions/contracts/${detail.recurringContract.id}/sync`,
      {
        method: "POST",
      }
    );
    const payload = await response.json();
    setSyncContractLoading(false);

    if (!response.ok || !payload.success) {
      toast.error(payload.message ?? "同步协议失败");
      return;
    }

    toast.success("协议状态已同步");
    router.refresh();
  };

  /**
   * 管理员同步账单状态。
   */
  const syncRecurringBilling = async () => {
    if (!detail?.recurringBilling) {
      return;
    }
    setSyncBillingLoading(true);
    const response = await fetch(
      `/api/platform/payments/admin/subscriptions/billings/${detail.recurringBilling.id}/sync`,
      {
        method: "POST",
      }
    );
    const payload = await response.json();
    setSyncBillingLoading(false);

    if (!response.ok || !payload.success) {
      toast.error(payload.message ?? "同步账单失败");
      return;
    }

    toast.success("账单状态已同步");
    router.refresh();
  };

  /**
   * 管理员手工补扣失败账单。
   */
  const retryRecurringBilling = async () => {
    if (!detail?.recurringBilling) {
      return;
    }
    setRetryBillingLoading(true);
    const response = await fetch(
      `/api/platform/payments/admin/subscriptions/billings/${detail.recurringBilling.id}/retry`,
      {
        method: "POST",
      }
    );
    const payload = await response.json();
    setRetryBillingLoading(false);

    if (!response.ok || !payload.success) {
      toast.error(payload.message ?? "手工补扣失败");
      return;
    }

    toast.success("补扣已发起");
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>支付中心</CardTitle>
          <CardDescription>
            按用户、订单号、渠道单号查看支付状态，后续退款和订阅代扣也会继续挂在这里。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="payment-query">搜索</Label>
            <Input
              id="payment-query"
              value={filters.query}
              placeholder="邮箱 / 订单号 / 渠道单号"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>支付渠道</Label>
            <Select
              value={filters.provider}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  provider: value as typeof current.provider,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="creem">Creem</SelectItem>
                <SelectItem value="wechat_pay">微信支付</SelectItem>
                <SelectItem value="alipay">支付宝</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>订单类型</Label>
            <Select
              value={filters.orderType}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  orderType: value as typeof current.orderType,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="credit_purchase">积分包</SelectItem>
                <SelectItem value="subscription">订阅</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>支付状态</Label>
            <Select
              value={filters.paymentState}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  paymentState: value as typeof current.paymentState,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="paid">已支付</SelectItem>
                <SelectItem value="confirmed">已确认</SelectItem>
                <SelectItem value="closed">已关闭</SelectItem>
                <SelectItem value="partial_refund">部分退款</SelectItem>
                <SelectItem value="refunded">已退款</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={applyFilters}>
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>支付列表</CardTitle>
            <CardDescription>
              共 {data.list.pagination.total} 笔，当前第{" "}
              {data.list.pagination.page} / {data.list.pagination.totalPages} 页
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">用户</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 font-medium">渠道</th>
                    <th className="px-3 py-2 font-medium">金额</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.list.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b align-top last:border-b-0"
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          {item.userName || "未命名用户"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.userEmail || item.userId}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {item.orderType === "credit_purchase"
                          ? "积分包"
                          : "订阅"}
                      </td>
                      <td className="px-3 py-3">
                        {formatProvider(item.provider)}
                      </td>
                      <td className="px-3 py-3">
                        {formatAmount(item.grossAmount, item.currency)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{item.status}</Badge>
                          {item.afterSalesStatus !== "none" ? (
                            <Badge variant="outline">
                              {item.afterSalesStatus}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {formatDateTime(item.paidAt || item.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openDetail(item.id)}
                        >
                          查看
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={data.list.pagination.page <= 1}
                onClick={() => jumpPage(data.list.pagination.page - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  data.list.pagination.page >= data.list.pagination.totalPages
                }
                onClick={() => jumpPage(data.list.pagination.page + 1)}
              >
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>支付详情</CardTitle>
            <CardDescription>
              {detail
                ? "查看原始支付、订单项和售后事件"
                : "从左侧列表选择一笔支付"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail ? (
              <div className="space-y-4 text-sm">
                <DetailLine label="订单号" value={detail.order.id} />
                <DetailLine
                  label="用户"
                  value={detail.order.userEmail || detail.order.userId}
                />
                <DetailLine
                  label="支付渠道"
                  value={formatProvider(detail.order.provider)}
                />
                <DetailLine
                  label="金额"
                  value={formatAmount(
                    detail.order.grossAmount,
                    detail.order.currency
                  )}
                />
                <DetailLine label="订单状态" value={detail.order.status} />
                <DetailLine
                  label="售后状态"
                  value={detail.order.afterSalesStatus}
                />
                <DetailLine
                  label="渠道订单号"
                  value={detail.order.providerOrderId || "-"}
                />
                <DetailLine
                  label="支付流水号"
                  value={detail.order.providerPaymentId || "-"}
                />
                <DetailLine
                  label="订阅号"
                  value={detail.order.providerSubscriptionId || "-"}
                />
                <DetailLine
                  label="支付时间"
                  value={formatDateTime(
                    detail.order.paidAt || detail.order.createdAt
                  )}
                />
                <div className="space-y-2">
                  <div className="font-medium">订单项</div>
                  {detail.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border p-3 text-xs text-muted-foreground"
                    >
                      <div>商品类型：{item.productType}</div>
                      <div>商品标识：{item.productId || "-"}</div>
                      <div>
                        可退金额：
                        {formatAmount(
                          item.refundableAmount,
                          detail.order.currency
                        )}
                      </div>
                      <div>
                        已退金额：
                        {formatAmount(
                          item.refundedAmount,
                          detail.order.currency
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="font-medium">支付意图</div>
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    {detail.paymentIntent ? (
                      <>
                        <div>intentId：{detail.paymentIntent.id}</div>
                        <div>outTradeNo：{detail.paymentIntent.outTradeNo}</div>
                        <div>状态：{detail.paymentIntent.status}</div>
                      </>
                    ) : (
                      <div>当前订单没有本地 payment_intent</div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="font-medium">售后事件</div>
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    {detail.afterSalesEvents.length > 0 ? (
                      detail.afterSalesEvents.map((item) => (
                        <div key={item.id}>
                          {item.eventType} /{" "}
                          {formatAmount(item.amount, item.currency)} /{" "}
                          {formatDateTime(item.eventTime)}
                        </div>
                      ))
                    ) : (
                      <div>暂无售后事件</div>
                    )}
                  </div>
                </div>
                {detail.recurringContract ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">连续扣费协议</div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={syncRecurringContract}
                        loading={syncContractLoading}
                        loadingText="同步中..."
                      >
                        同步协议
                      </Button>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground">
                      <div>协议号：{detail.recurringContract.id}</div>
                      <div>渠道协议号：{detail.recurringContract.providerContractId || "-"}</div>
                      <div>状态：{detail.recurringContract.status}</div>
                      <div>下次扣费：{detail.recurringContract.nextBillingAt ? formatDateTime(detail.recurringContract.nextBillingAt) : "-"}</div>
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-5">
                      {JSON.stringify(detail.recurringContract.metadata ?? {}, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {detail.recurringBilling ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-medium">连续扣费账单</div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={syncRecurringBilling}
                          loading={syncBillingLoading}
                          loadingText="同步中..."
                        >
                          同步账单
                        </Button>
                        {detail.recurringBilling.status === "failed" ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={retryRecurringBilling}
                            loading={retryBillingLoading}
                            loadingText="补扣中..."
                          >
                            手工补扣
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground">
                      <div>账单号：{detail.recurringBilling.id}</div>
                      <div>商户单号：{detail.recurringBilling.outTradeNo}</div>
                      <div>渠道流水：{detail.recurringBilling.providerPaymentId || "-"}</div>
                      <div>状态：{detail.recurringBilling.status}</div>
                      <div>失败原因：{detail.recurringBilling.failureReason || "-"}</div>
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-5">
                      {JSON.stringify(detail.recurringBilling.metadata ?? {}, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {detail.order.orderType === "credit_purchase" &&
                detail.items[0] ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="font-medium">发起退款</div>
                    <div className="space-y-2">
                      <Label htmlFor="refund-amount">退款金额（分）</Label>
                      <Input
                        id="refund-amount"
                        value={refundAmount}
                        onChange={(event) =>
                          setRefundAmount(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="refund-reason">退款原因</Label>
                      <Input
                        id="refund-reason"
                        value={refundReason}
                        onChange={(event) =>
                          setRefundReason(event.target.value)
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={submitRefund}
                      loading={refundLoading}
                      loadingText="退款中..."
                      disabled={
                        refundLoading ||
                        Number(refundAmount) <= 0 ||
                        Number(refundAmount) > detail.items[0].refundableAmount
                      }
                    >
                      提交退款
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      当前阶段只开放积分包退款，且退款前会先回收对应积分。
                    </div>
                  </div>
                ) : null}
                {detail.order.orderType === "subscription" && detail.items[0] ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="font-medium">订阅退款</div>
                    <div className="space-y-2">
                      <Label htmlFor="subscription-refund-amount">
                        退款金额（分）
                      </Label>
                      <Input
                        id="subscription-refund-amount"
                        value={refundAmount}
                        onChange={(event) =>
                          setRefundAmount(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subscription-refund-reason">
                        退款原因
                      </Label>
                      <Input
                        id="subscription-refund-reason"
                        value={refundReason}
                        onChange={(event) =>
                          setRefundReason(event.target.value)
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={submitRefund}
                      loading={refundLoading}
                      loadingText="退款中..."
                      disabled={
                        refundLoading ||
                        Number(refundAmount) !== detail.items[0].refundableAmount
                      }
                    >
                      提交全额退款
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      当前阶段订阅只支持整单退款。退款后会回收本期积分，并暂停连续扣费协议。
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">暂无详情</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailLine(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="break-all font-medium">{props.value}</div>
    </div>
  );
}

function syncParam(searchParams: URLSearchParams, key: string, value: string) {
  if (value) {
    searchParams.set(key, value);
    return;
  }
  searchParams.delete(key);
}

function formatProvider(provider: string) {
  switch (provider) {
    case "wechat_pay":
      return "微信支付";
    case "alipay":
      return "支付宝";
    case "creem":
      return "Creem";
    default:
      return provider;
  }
}

function formatAmount(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`;
}

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}
