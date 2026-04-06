"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  BadgeDollarSign,
  Copy,
  Loader2,
  Network,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createDistributionWithdrawalAction,
  createDistributionWithdrawalSchema,
} from "@/features/distribution/actions";
import {
  buildReferralLink,
  formatDistributionAmount,
  formatDistributionDate,
  getDefaultDistributionCurrency,
  getAfterSalesLabel,
  getAvailableCommissionRatio,
  getCommissionStatusMeta,
  getOrderTypeLabel,
  getWithdrawalStatusMeta,
} from "@/features/distribution/presentation";

/**
 * 代理端分销中心数据类型
 */
interface DistributionDashboardViewProps {
  data: {
    profile: {
      status: "active" | "inactive";
      agentLevel: string | null;
      displayName: string | null;
      depth: number;
      boundAt: Date | null;
      path: string | null;
    } | null;
    balance: {
      currency: string;
      totalEarned: number;
      availableAmount: number;
      frozenAmount: number;
      withdrawnAmount: number;
      reversedAmount: number;
    } | null;
    referralCodes: Array<{
      id: string;
      code: string;
      campaign: string | null;
      landingPath: string | null;
      status: "active" | "inactive";
      createdAt: Date;
    }>;
    orders: Array<{
      id: string;
      orderType: "subscription" | "credit_purchase";
      status: "pending" | "paid" | "confirmed" | "closed";
      afterSalesStatus: "none" | "partial_refund" | "refunded" | "returned" | "chargeback";
      grossAmount: number;
      currency: string;
      referralCode: string | null;
      paidAt: Date | null;
      createdAt: Date;
    }>;
    commissionRecords: Array<{
      id: string;
      amount: number;
      currency: string;
      status: "frozen" | "available" | "reversed" | "withdrawn";
      availableAt: Date | null;
      createdAt: Date;
      reversalReason: string | null;
    }>;
    withdrawals: Array<{
      id: string;
      amount: number;
      feeAmount: number;
      netAmount: number;
      currency: string;
      status: "pending" | "approved" | "rejected" | "paid" | "failed";
      payeeSnapshot: Record<string, unknown> | null;
      createdAt: Date;
      reviewedAt: Date | null;
      paidAt: Date | null;
    }>;
    summary: {
      attributedOrders: number;
      refundedOrders: number;
      pendingWithdrawals: number;
    };
  };
}

type WithdrawalFormValues = z.infer<typeof createDistributionWithdrawalSchema>;

/**
 * 代理端分销中心页面主体
 */
export function DistributionDashboardView({
  data,
}: DistributionDashboardViewProps) {
  const balance = data.balance ?? {
    currency: getDefaultDistributionCurrency(),
    totalEarned: 0,
    availableAmount: 0,
    frozenAmount: 0,
    withdrawnAmount: 0,
    reversedAmount: 0,
  };

  // 提现表单直接调用服务端 action。
  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(createDistributionWithdrawalSchema),
    defaultValues: {
      amount: 0,
      feeAmount: 0,
      channel: "bank_transfer",
      accountName: "",
      accountNo: "",
      note: "",
    },
  });

  const { execute, isPending } = useAction(createDistributionWithdrawalAction, {
    onSuccess: ({ data: result }) => {
      if (result?.message) {
        toast.success(result.message);
        form.reset({
          amount: 0,
          feeAmount: 0,
          channel: "bank_transfer",
          accountName: "",
          accountNo: "",
          note: "",
        });
      }
    },
    onError: ({ error }) => {
      if (error.serverError) {
        toast.error(error.serverError);
      }
      if (error.validationErrors) {
        const errors = Object.values(error.validationErrors).flat();
        toast.error(errors.join("，") || "提现申请失败");
      }
    },
  });

  /**
   * 复制推广链接
   */
  const handleCopyReferralLink = async (code: string, landingPath?: string | null) => {
    await navigator.clipboard.writeText(buildReferralLink(code, landingPath));
    toast.success("推广链接已复制");
  };

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white shadow-none">
        <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-white/10 text-white hover:bg-white/10">
                分销中心
              </Badge>
              <Badge
                variant={data.profile?.status === "active" ? "secondary" : "outline"}
                className="border-white/20 bg-white/5 text-white"
              >
                {data.profile?.status === "active" ? "代理已开通" : "待开通"}
              </Badge>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {data.profile?.displayName || "推广与佣金看板"}
              </h1>
              <p className="max-w-2xl text-sm text-slate-300">
                在这里查看推广链接、归因订单、佣金变动和提现处理进度。当前账号继续复用主站用户体系，不需要额外注册代理账户。
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-200">
              <span>代理等级：{data.profile?.agentLevel || "L1"}</span>
              <span>关系层级：{data.profile?.depth ?? 0}</span>
              <span>绑定时间：{formatDistributionDate(data.profile?.boundAt)}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Wallet className="h-4 w-4" />
              可提现进度
            </div>
            <div className="mt-4 text-3xl font-semibold">
              {formatDistributionAmount(balance.availableAmount, balance.currency)}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              总累计 {formatDistributionAmount(balance.totalEarned, balance.currency)}
            </p>
            <div className="mt-4 space-y-2">
              <Progress
                value={getAvailableCommissionRatio({
                  availableAmount: balance.availableAmount,
                  totalEarned: balance.totalEarned,
                })}
                className="bg-white/10"
              />
              <div className="flex justify-between text-xs text-slate-300">
                <span>冻结中 {formatDistributionAmount(balance.frozenAmount, balance.currency)}</span>
                <span>已提现 {formatDistributionAmount(balance.withdrawnAmount, balance.currency)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">累计佣金</CardTitle>
            <BadgeDollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatDistributionAmount(balance.totalEarned, balance.currency)}
            </div>
            <p className="text-xs text-muted-foreground">
              已冲正 {formatDistributionAmount(balance.reversedAmount, balance.currency)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">归因订单</CardTitle>
            <ReceiptText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.summary.attributedOrders}</div>
            <p className="text-xs text-muted-foreground">
              售后订单 {data.summary.refundedOrders}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">推广码</CardTitle>
            <Network className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.referralCodes.length}</div>
            <p className="text-xs text-muted-foreground">
              当前展示最近 6 条有效入口
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">提现申请</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.summary.pendingWithdrawals}</div>
            <p className="text-xs text-muted-foreground">
              待处理申请数
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="rounded-xl border bg-background p-1">
          <TabsTrigger value="overview">总览</TabsTrigger>
          <TabsTrigger value="orders">订单</TabsTrigger>
          <TabsTrigger value="commissions">佣金</TabsTrigger>
          <TabsTrigger value="withdrawals">提现</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>推广链接</CardTitle>
              <CardDescription>
                直接使用下面的推广入口进行投放，订单会在 webhook 落单后自动写入归因。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.referralCodes.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  当前还没有推广码。后端归因能力已经准备好，补充推广码后这里会直接展示可投放入口。
                </div>
              ) : (
                data.referralCodes.map((code) => (
                  <div key={code.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{code.code}</p>
                          <Badge variant={code.status === "active" ? "default" : "outline"}>
                            {code.status === "active" ? "启用中" : "已停用"}
                          </Badge>
                          {code.campaign ? (
                            <Badge variant="outline">{code.campaign}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {buildReferralLink(code.code, code.landingPath)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyReferralLink(code.code, code.landingPath)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        复制链接
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>关系状态</CardTitle>
              <CardDescription>
                当前代理资料和绑定路径信息。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-muted/50 p-4">
                <div className="text-sm text-muted-foreground">代理身份</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.profile?.displayName || "未设置展示名称"}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">等级 {data.profile?.agentLevel || "L1"}</Badge>
                  <Badge variant="outline">深度 {data.profile?.depth ?? 0}</Badge>
                  <Badge variant="outline">状态 {data.profile?.status || "inactive"}</Badge>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">绑定时间</span>
                  <span>{formatDistributionDate(data.profile?.boundAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">关系路径</span>
                  <span className="max-w-[60%] truncate text-right">
                    {data.profile?.path || "尚未写入"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">当前可提现</span>
                  <span>{formatDistributionAmount(balance.availableAmount, balance.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <CardTitle>最近归因订单</CardTitle>
              <CardDescription>
                当前展示最近 8 条已归因到你的订单。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.orders.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  还没有归因订单。支付完成后，订单会自动进入统一订单中心并显示在这里。
                </div>
              ) : (
                data.orders.map((order) => (
                  <div
                    key={order.id}
                    className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{getOrderTypeLabel(order.orderType)}</p>
                        <Badge variant="outline">{order.status}</Badge>
                        <Badge
                          variant={order.afterSalesStatus === "none" ? "outline" : "secondary"}
                        >
                          {getAfterSalesLabel(order.afterSalesStatus)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        订单号 {order.id.slice(0, 8)} · 推广码 {order.referralCode || "未记录"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatDistributionAmount(order.grossAmount, order.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistributionDate(order.paidAt || order.createdAt)}
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
              <CardTitle>最近佣金记录</CardTitle>
              <CardDescription>
                展示冻结、可提现、冲正和提现后的佣金状态。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.commissionRecords.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  暂无佣金记录。只要有有效归因订单并命中分佣规则，就会自动写入这里。
                </div>
              ) : (
                data.commissionRecords.map((record) => {
                  const statusMeta = getCommissionStatusMeta(record.status);
                  return (
                    <div
                      key={record.id}
                      className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">佣金记录 {record.id.slice(0, 8)}</p>
                          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          创建于 {formatDistributionDate(record.createdAt)}
                          {record.availableAt ? ` · 可用时间 ${formatDistributionDate(record.availableAt)}` : ""}
                        </p>
                        {record.reversalReason ? (
                          <p className="text-xs text-destructive">
                            冲正原因：{record.reversalReason}
                          </p>
                        ) : null}
                      </div>
                      <div className="font-semibold">
                        {formatDistributionAmount(record.amount, record.currency)}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="withdrawals" className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>发起提现</CardTitle>
              <CardDescription>
                当前只会冻结可提现余额，管理员打款后才会进入已提现金额。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  className="space-y-4"
                  onSubmit={form.handleSubmit((values) => execute(values))}
                >
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>提现金额</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            max={Math.max(balance.availableAmount, 1)}
                            disabled={isPending}
                            {...field}
                            value={Number(field.value || 0)}
                            onChange={(event) => field.onChange(Number(event.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          当前可提现 {formatDistributionAmount(balance.availableAmount, balance.currency)}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="feeAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>手续费</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            disabled={isPending}
                            {...field}
                            value={Number(field.value || 0)}
                            onChange={(event) => field.onChange(Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="channel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>收款渠道</FormLabel>
                        <FormControl>
                          <Input disabled={isPending} placeholder="bank_transfer / alipay / wechat" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="accountName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>收款人</FormLabel>
                        <FormControl>
                          <Input disabled={isPending} placeholder="请输入收款人姓名" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="accountNo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>收款账号</FormLabel>
                        <FormControl>
                          <Input disabled={isPending} placeholder="请输入银行卡或钱包账号" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>备注</FormLabel>
                        <FormControl>
                          <Textarea disabled={isPending} rows={3} placeholder="可填写打款说明或渠道备注" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" className="w-full" disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    提交提现申请
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>提现记录</CardTitle>
              <CardDescription>
                展示最近 8 条提现申请和处理结果。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.withdrawals.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  暂无提现记录。
                </div>
              ) : (
                data.withdrawals.map((item) => {
                  const statusMeta = getWithdrawalStatusMeta(item.status);
                  const payee = item.payeeSnapshot ?? {};
                  return (
                    <div key={item.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">申请 {item.id.slice(0, 8)}</p>
                            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {String(payee.channel || "未填写")} · {String(payee.accountName || "未填写")} · {String(payee.accountNo || "未填写")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            提交 {formatDistributionDate(item.createdAt)}
                            {item.paidAt ? ` · 打款 ${formatDistributionDate(item.paidAt)}` : ""}
                          </p>
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="font-semibold">
                            {formatDistributionAmount(item.amount, item.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            手续费 {formatDistributionAmount(item.feeAmount, item.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            到账 {formatDistributionAmount(item.netAmount, item.currency)}
                          </p>
                        </div>
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
        当前页面只展示前端和已接好的后端主链。继续推进时，二级分佣、打款凭证上传和渠道化退款 webhook 都可以挂在这套页面结构上。
        <ArrowRight className="ml-2 inline h-4 w-4" />
      </div>
    </div>
  );
}
