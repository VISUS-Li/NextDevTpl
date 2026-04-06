"use client";

import {
  ArrowDownToLine,
  ArrowUpRight,
  BadgeDollarSign,
  Loader2,
  Network,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { reviewDistributionWithdrawalAction } from "@/features/distribution/actions";
import {
  formatDistributionAmount,
  formatDistributionDate,
  getAfterSalesLabel,
  getCommissionStatusMeta,
  getOrderTypeLabel,
  getWithdrawalStatusMeta,
} from "@/features/distribution/presentation";

/**
 * 管理端分销视图数据类型
 */
interface AdminDistributionViewProps {
  data: {
    summary: {
      activeAgents: number;
      attributedOrders: number;
      pendingWithdrawals: number;
      totalCommission: number;
      availableCommission: number;
      frozenCommission: number;
    };
    agentBalances: Array<{
      profileId: string;
      userId: string;
      displayName: string | null;
      agentLevel: string | null;
      status: "active" | "inactive";
      depth: number;
      boundAt: Date | null;
      userName: string | null;
      email: string | null;
      availableAmount: number | null;
      frozenAmount: number | null;
      withdrawnAmount: number | null;
    }>;
    recentOrders: Array<{
      id: string;
      userId: string;
      orderType: "subscription" | "credit_purchase";
      status: "pending" | "paid" | "confirmed" | "closed";
      afterSalesStatus: "none" | "partial_refund" | "refunded" | "returned" | "chargeback";
      grossAmount: number;
      currency: string;
      referralCode: string | null;
      attributedAgentUserId: string | null;
      paidAt: Date | null;
      createdAt: Date;
      buyerName: string | null;
      buyerEmail: string | null;
    }>;
    recentCommissions: Array<{
      id: string;
      beneficiaryUserId: string;
      amount: number;
      currency: string;
      status: "frozen" | "available" | "reversed" | "withdrawn";
      availableAt: Date | null;
      createdAt: Date;
      beneficiaryName: string | null;
      beneficiaryEmail: string | null;
    }>;
    recentWithdrawals: Array<{
      id: string;
      userId: string;
      amount: number;
      feeAmount: number;
      netAmount: number;
      currency: string;
      status: "pending" | "approved" | "rejected" | "paid" | "failed";
      operatorNote: string | null;
      payeeSnapshot: Record<string, unknown> | null;
      createdAt: Date;
      reviewedAt: Date | null;
      paidAt: Date | null;
      userName: string | null;
      userEmail: string | null;
    }>;
  };
}

/**
 * 管理端分销总览页面主体
 */
export function AdminDistributionView({ data }: AdminDistributionViewProps) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});

  // 提现审核复用后端状态机，不再单独写接口层。
  const { execute, isPending } = useAction(reviewDistributionWithdrawalAction, {
    onSuccess: ({ data: result }) => {
      if (result?.message) {
        toast.success(result.message);
        router.refresh();
      }
    },
    onError: ({ error }) => {
      if (error.serverError) {
        toast.error(error.serverError);
      }
      if (error.validationErrors) {
        const errors = Object.values(error.validationErrors).flat();
        toast.error(errors.join("，") || "处理失败");
      }
    },
  });

  /**
   * 处理提现审核动作
   */
  const handleReview = (requestId: string, decision: "reject" | "paid") => {
    execute({
      requestId,
      decision,
      note: notes[requestId] || "",
    });
  };

  const pendingWithdrawals = data.recentWithdrawals.filter((item) => item.status === "pending");

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-none">
        <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              分销运营中心
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">分销、佣金与提现后台</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                这里直接对接统一订单、佣金账本和提现状态机。当前重点是查账、查归因和处理待打款申请，避免账务链路在后台断掉。
              </p>
            </div>
          </div>

          <div className="rounded-2xl border bg-slate-50 p-5">
            <div className="text-sm text-muted-foreground">待处理提现</div>
            <div className="mt-2 text-3xl font-semibold">
              {data.summary.pendingWithdrawals}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              冻结池 {formatDistributionAmount(data.summary.frozenCommission)}
            </p>
            <p className="text-sm text-muted-foreground">
              可提现池 {formatDistributionAmount(data.summary.availableCommission)}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">活跃代理</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.summary.activeAgents}</div>
            <p className="text-xs text-muted-foreground">已绑定代理资料的用户数</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">推广成交订单</CardTitle>
            <ReceiptText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.summary.attributedOrders}</div>
            <p className="text-xs text-muted-foreground">已进入分销主链的订单数</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">累计佣金</CardTitle>
            <BadgeDollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatDistributionAmount(data.summary.totalCommission)}
            </div>
            <p className="text-xs text-muted-foreground">
              冻结 {formatDistributionAmount(data.summary.frozenCommission)} · 可提现 {formatDistributionAmount(data.summary.availableCommission)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="rounded-xl border bg-background p-1">
          <TabsTrigger value="overview">总览</TabsTrigger>
          <TabsTrigger value="withdrawals">提现审核</TabsTrigger>
          <TabsTrigger value="agents">代理</TabsTrigger>
          <TabsTrigger value="orders">订单</TabsTrigger>
          <TabsTrigger value="commissions">佣金</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>待处理提现</CardTitle>
              <CardDescription>
                当前展示最新待处理申请，便于快速审核。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingWithdrawals.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  当前没有待处理提现。
                </div>
              ) : (
                pendingWithdrawals.slice(0, 4).map((item) => {
                  const payee = item.payeeSnapshot ?? {};
                  return (
                    <div key={item.id} className="rounded-xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.userName || item.userEmail || item.userId}</p>
                          <p className="text-xs text-muted-foreground">
                            {String(payee.channel || "未填写")} · {String(payee.accountName || "未填写")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">
                            {formatDistributionAmount(item.amount, item.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistributionDate(item.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>运营说明</CardTitle>
              <CardDescription>
                当前这套界面主要承担查账和操作入口，不改变已实现的后端账务逻辑。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-xl bg-muted/50 p-4">
                统一订单、归因、佣金解冻、售后冲正和提现冻结都已经接通，管理端只需要围绕这条主链补可见性和操作性。
              </div>
              <div className="rounded-xl bg-muted/50 p-4">
                当前仍然没有二级、三级分佣，也没有已提现退款负债处理，审核时需要按一级代理和当前可见账本理解。
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="withdrawals">
          <Card>
            <CardHeader>
              <CardTitle>提现审核列表</CardTitle>
              <CardDescription>
                可直接驳回或标记打款，动作会同步回写佣金余额和账本。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.recentWithdrawals.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  暂无提现申请。
                </div>
              ) : (
                data.recentWithdrawals.map((item) => {
                  const statusMeta = getWithdrawalStatusMeta(item.status);
                  const payee = item.payeeSnapshot ?? {};
                  return (
                    <div key={item.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {item.userName || item.userEmail || item.userId}
                            </p>
                            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            申请号 {item.id.slice(0, 8)} · 提交 {formatDistributionDate(item.createdAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {String(payee.channel || "未填写")} · {String(payee.accountName || "未填写")} · {String(payee.accountNo || "未填写")}
                          </p>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <span>金额 {formatDistributionAmount(item.amount, item.currency)}</span>
                            <span>手续费 {formatDistributionAmount(item.feeAmount, item.currency)}</span>
                            <span>到账 {formatDistributionAmount(item.netAmount, item.currency)}</span>
                          </div>
                        </div>

                        <div className="w-full space-y-3 xl:max-w-sm">
                          <Textarea
                            rows={3}
                            placeholder="填写审核备注或打款说明"
                            value={notes[item.id] ?? item.operatorNote ?? ""}
                            onChange={(event) =>
                              setNotes((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                          {item.status === "pending" ? (
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                disabled={isPending}
                                onClick={() => handleReview(item.id, "reject")}
                              >
                                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownToLine className="mr-2 h-4 w-4" />}
                                驳回申请
                              </Button>
                              <Button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleReview(item.id, "paid")}
                              >
                                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpRight className="mr-2 h-4 w-4" />}
                                标记打款
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              处理时间 {formatDistributionDate(item.reviewedAt || item.paidAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <Card>
            <CardHeader>
              <CardTitle>代理与余额</CardTitle>
              <CardDescription>
                当前展示最近 8 位代理及其余额快照。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.agentBalances.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  暂无代理资料。
                </div>
              ) : (
                data.agentBalances.map((item) => (
                  <div
                    key={item.profileId}
                    className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {item.displayName || item.userName || item.userId}
                        </p>
                        <Badge variant={item.status === "active" ? "default" : "outline"}>
                          {item.status}
                        </Badge>
                        <Badge variant="outline">{item.agentLevel || "L1"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.email || "未记录邮箱"} · 绑定 {formatDistributionDate(item.boundAt)}
                      </p>
                    </div>
                    <div className="grid gap-2 text-sm md:text-right">
                      <span>可提现 {formatDistributionAmount(item.availableAmount ?? 0)}</span>
                      <span>冻结 {formatDistributionAmount(item.frozenAmount ?? 0)}</span>
                      <span>已提现 {formatDistributionAmount(item.withdrawnAmount ?? 0)}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <CardTitle>推广成交订单</CardTitle>
              <CardDescription>
                展示最近进入分销链路的订单。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.recentOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  暂无推广成交订单。
                </div>
              ) : (
                data.recentOrders.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{getOrderTypeLabel(item.orderType)}</p>
                        <Badge variant="outline">{item.status}</Badge>
                        <Badge
                          variant={item.afterSalesStatus === "none" ? "outline" : "secondary"}
                        >
                          {getAfterSalesLabel(item.afterSalesStatus)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.buyerName || item.buyerEmail || item.userId} · 推广码 {item.referralCode || "未记录"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatDistributionAmount(item.grossAmount, item.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistributionDate(item.paidAt || item.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commissions">
          <Card>
            <CardHeader>
              <CardTitle>佣金记录</CardTitle>
              <CardDescription>
                展示最近佣金记录的状态和可用时间。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.recentCommissions.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  暂无佣金记录。
                </div>
              ) : (
                data.recentCommissions.map((item) => {
                  const statusMeta = getCommissionStatusMeta(item.status);
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {item.beneficiaryName || item.beneficiaryEmail || item.beneficiaryUserId}
                          </p>
                          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          记录 {item.id.slice(0, 8)} · 创建 {formatDistributionDate(item.createdAt)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          可用时间 {formatDistributionDate(item.availableAt)}
                        </p>
                      </div>
                      <div className="font-semibold">
                        {formatDistributionAmount(item.amount, item.currency)}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">
        当前管理端已经能直接处理提现审核和查账，后续再补规则配置、多级分佣和已提现负债处理。
        <Network className="ml-2 inline h-4 w-4" />
      </div>
    </div>
  );
}
