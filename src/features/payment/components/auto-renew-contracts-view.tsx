"use client";

import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { listUserSubscriptionContracts } from "@/features/payment/subscription-recurring";
import { PlanInterval } from "@/features/payment/types";

type SubscriptionContractList = Awaited<
  ReturnType<typeof listUserSubscriptionContracts>
>;

type AutoRenewContractsViewProps = {
  contracts: SubscriptionContractList;
  mockMode: boolean;
};

/**
 * 用户侧自动续费签约页。
 */
export function AutoRenewContractsView(props: AutoRenewContractsViewProps) {
  const router = useRouter();
  const [provider, setProvider] = useState<"wechat_pay" | "alipay">(
    "wechat_pay"
  );
  const [planId, setPlanId] = useState<"starter" | "pro" | "ultra">("starter");
  const [interval, setInterval] = useState<PlanInterval>(PlanInterval.MONTH);
  const [loading, setLoading] = useState(false);
  const [pendingContractId, setPendingContractId] = useState<string | null>(
    null
  );
  const [planDrafts, setPlanDrafts] = useState<
    Record<string, { planId: "starter" | "pro" | "ultra"; interval: PlanInterval }>
  >({});

  /**
   * 创建连续扣费签约。
   */
  const createContract = async () => {
    setLoading(true);
    const response = await fetch(
      "/api/platform/payment/subscription/contracts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          planId,
          interval,
        }),
      }
    );
    const payload = await response.json();
    setLoading(false);

    if (!response.ok || !payload.success) {
      toast.error(payload.error ?? "创建签约失败");
      return;
    }

    toast.success("签约单已创建");
    router.refresh();
  };

  /**
   * 模拟签约成功。
   */
  const simulateActivate = async (
    contractId: string,
    target: "wechat_pay" | "alipay"
  ) => {
    const response =
      target === "wechat_pay"
        ? await fetch("/api/webhooks/wechat-pay/subscription-contract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contract_id: contractId,
              provider_contract_id: `mock_${target}_${contractId}`,
              contract_status: "ACTIVE",
            }),
          })
        : await fetch("/api/webhooks/alipay/subscription-contract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              out_agreement_no: contractId,
              agreement_no: `mock_${target}_${contractId}`,
              status: "ACTIVE",
            }),
          });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      toast.error(payload.error ?? "模拟签约失败");
      return;
    }

    toast.success("模拟签约成功");
    router.refresh();
  };

  /**
   * 触发首期账单，模拟模式下会自动回调成功。
   */
  const triggerBilling = async (
    contractId: string,
    target: "wechat_pay" | "alipay"
  ) => {
    setPendingContractId(contractId);
    const billingResponse = await fetch(
      `/api/platform/payment/subscription/contracts/${contractId}/bill`,
      {
        method: "POST",
      }
    );
    const billingPayload = await billingResponse.json();
    if (!billingResponse.ok || !billingPayload.success) {
      setPendingContractId(null);
      toast.error(billingPayload.error ?? "生成账单失败");
      return;
    }

    if (!props.mockMode) {
      setPendingContractId(null);
      toast.success("账单已创建，请等待渠道扣款回调");
      router.refresh();
      return;
    }

    const webhookResponse =
      target === "wechat_pay"
        ? await fetch("/api/webhooks/wechat-pay/subscription-billing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              out_trade_no: billingPayload.billing.outTradeNo,
              transaction_id: `mock_pay_${billingPayload.billing.id}`,
              trade_state: "SUCCESS",
            }),
          })
        : await fetch("/api/webhooks/alipay/subscription-billing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              out_trade_no: billingPayload.billing.outTradeNo,
              trade_no: `mock_pay_${billingPayload.billing.id}`,
              trade_status: "TRADE_SUCCESS",
            }),
          });

    const webhookPayload = await webhookResponse.json();
    setPendingContractId(null);
    if (!webhookResponse.ok || !webhookPayload.success) {
      toast.error(webhookPayload.error ?? "模拟扣款失败");
      return;
    }

    toast.success("模拟扣款成功");
    router.refresh();
  };

  /**
   * 用户主动解约。
   */
  const cancelContract = async (contractId: string) => {
    setPendingContractId(contractId);
    const response = await fetch(
      `/api/platform/payment/subscription/contracts/${contractId}`,
      {
        method: "DELETE",
      }
    );
    const payload = await response.json();
    setPendingContractId(null);

    if (!response.ok || !payload.success) {
      toast.error(payload.error ?? "解约失败");
      return;
    }

    toast.success("已解约");
    router.refresh();
  };

  /**
   * 保存下周期生效的套餐变更。
   */
  const changePlan = async (contractId: string) => {
    const draft = planDrafts[contractId];
    if (!draft) {
      toast.error("请选择目标套餐");
      return;
    }

    setPendingContractId(contractId);
    const response = await fetch(
      `/api/platform/payment/subscription/contracts/${contractId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }
    );
    const payload = await response.json();
    setPendingContractId(null);

    if (!response.ok || !payload.success) {
      toast.error(payload.error ?? "保存套餐变更失败");
      return;
    }

    toast.success("已保存，下个账期生效");
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>自动续费签约</CardTitle>
          <CardDescription>
            统一管理微信连续扣费和支付宝代扣订阅。模拟模式下可直接在当前页完成签约和首期扣款。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>支付方式</Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                setProvider(value as "wechat_pay" | "alipay")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wechat_pay">微信连续扣费</SelectItem>
                <SelectItem value="alipay">支付宝代扣</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>订阅计划</Label>
            <Select
              value={planId}
              onValueChange={(value) => setPlanId(value as typeof planId)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="ultra">Ultra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>账期</Label>
            <Select
              value={interval}
              onValueChange={(value) => setInterval(value as PlanInterval)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PlanInterval.MONTH}>月付</SelectItem>
                <SelectItem value={PlanInterval.YEAR}>年付</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={createContract}
              loading={loading}
              loadingText="创建中..."
            >
              创建签约
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {props.contracts.map((contract) => (
          <Card key={contract.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span>
                  {contract.provider === "wechat_pay"
                    ? "微信连续扣费"
                    : "支付宝代扣"}
                </span>
                <Badge variant="secondary">{contract.status}</Badge>
              </CardTitle>
              <CardDescription>
                {contract.planId} / {contract.interval} /{" "}
                {(contract.amount / 100).toFixed(2)} {contract.currency}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>签约单号：{contract.id}</div>
              <div>渠道协议号：{contract.providerContractId || "-"}</div>
              <div>
                下次扣款时间：
                {contract.nextBillingAt?.toLocaleString("zh-CN") || "-"}
              </div>
              {contract.pendingPlanId ? (
                <div>
                  待生效套餐：
                  {contract.pendingPlanId} / {contract.pendingInterval} /{" "}
                  {contract.pendingAmount
                    ? (contract.pendingAmount / 100).toFixed(2)
                    : "-"}{" "}
                  {contract.currency}
                </div>
              ) : null}
              {["active", "paused"].includes(contract.status) ? (
                <div className="grid gap-3 rounded-md border p-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>下周期套餐</Label>
                    <Select
                      value={
                        planDrafts[contract.id]?.planId ??
                        contract.pendingPlanId ??
                        contract.planId
                      }
                      onValueChange={(value) =>
                        setPlanDrafts((current) => ({
                          ...current,
                          [contract.id]: {
                            planId: value as "starter" | "pro" | "ultra",
                            interval:
                              current[contract.id]?.interval ??
                              contract.pendingInterval ??
                              contract.interval,
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="ultra">Ultra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>下周期账期</Label>
                    <Select
                      value={
                        planDrafts[contract.id]?.interval ??
                        contract.pendingInterval ??
                        contract.interval
                      }
                      onValueChange={(value) =>
                        setPlanDrafts((current) => ({
                          ...current,
                          [contract.id]: {
                            planId:
                              current[contract.id]?.planId ??
                              contract.pendingPlanId ??
                              contract.planId,
                            interval: value as PlanInterval,
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PlanInterval.MONTH}>月付</SelectItem>
                        <SelectItem value={PlanInterval.YEAR}>年付</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => changePlan(contract.id)}
                      loading={pendingContractId === contract.id}
                      loadingText="保存中..."
                    >
                      保存下周期变更
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {contract.signingUrl ? (
                  <Button asChild variant="outline">
                    <a
                      href={contract.signingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开签约页
                    </a>
                  </Button>
                ) : null}
                {props.mockMode && contract.status === "pending_sign" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      simulateActivate(
                        contract.id,
                        contract.provider as "wechat_pay" | "alipay"
                      )
                    }
                  >
                    模拟签约成功
                  </Button>
                ) : null}
                {contract.status === "active" ? (
                  <Button
                    type="button"
                    onClick={() =>
                      triggerBilling(
                        contract.id,
                        contract.provider as "wechat_pay" | "alipay"
                      )
                    }
                    loading={pendingContractId === contract.id}
                    loadingText={props.mockMode ? "扣款中..." : "生成中..."}
                  >
                    {props.mockMode ? "生成账单并模拟扣款" : "生成首期账单"}
                  </Button>
                ) : null}
                {["pending_sign", "active", "paused"].includes(
                  contract.status
                ) ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => cancelContract(contract.id)}
                    loading={pendingContractId === contract.id}
                    loadingText="解约中..."
                  >
                    解约
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {props.contracts.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              还没有自动续费签约
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
