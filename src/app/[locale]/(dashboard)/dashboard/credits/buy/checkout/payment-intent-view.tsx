"use client";

import { Loader2, QrCode, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PaymentIntentResponse = {
  success: boolean;
  intent?: {
    id: string;
    provider: string;
    status: string;
    displayMode: "redirect" | "qrcode";
    packageId: string;
    credits: number;
    amount: number;
    currency: string;
    subject: string;
    outTradeNo: string;
    checkoutUrl: string | null;
    qrCodeUrl: string | null;
    expiresAt: string | null;
    paidAt: string | null;
  };
  error?: string;
};

/**
 * 积分购买收银台。
 */
export function CheckoutPaymentIntentView({ intentId }: { intentId: string }) {
  const router = useRouter();
  const [data, setData] = useState<PaymentIntentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let active = true;

    // 轮询本地支付状态，支付成功后跳回用量页。
    const load = async () => {
      const response = await fetch(
        `/api/platform/payment/intents/${intentId}`,
        {
          cache: "no-store",
        }
      );
      const payload = (await response.json()) as PaymentIntentResponse;
      if (!active) {
        return;
      }
      setData(payload);
      setLoading(false);

      if (payload.intent?.status === "paid") {
        router.replace("/dashboard/settings?tab=usage&success=true");
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [intentId, router]);

  useEffect(() => {
    if (
      data?.intent?.displayMode === "redirect" &&
      data.intent.checkoutUrl &&
      data.intent.status === "pending" &&
      !redirecting
    ) {
      setRedirecting(true);
      window.location.href = data.intent.checkoutUrl;
    }
  }, [data, redirecting]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data?.success || !data.intent) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Card>
          <CardHeader>
            <CardTitle>支付单不存在</CardTitle>
            <CardDescription>
              {data?.error ?? "请返回重新发起支付"}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => router.push("/dashboard/credits/buy")}>
              返回购买页
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const intent = data.intent;
  const qrPreviewUrl = intent.qrCodeUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(intent.qrCodeUrl)}`
    : null;

  return (
    <div className="mx-auto max-w-3xl py-12">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>支付收银台</CardTitle>
              <CardDescription>{intent.subject}</CardDescription>
            </div>
            <Badge variant={intent.status === "paid" ? "default" : "secondary"}>
              {resolveStatusLabel(intent.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 rounded-xl border p-4 text-sm md:grid-cols-2">
            <div>
              <p className="text-muted-foreground">支付渠道</p>
              <p>{resolveProviderLabel(intent.provider)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">积分数量</p>
              <p>{intent.credits} 积分</p>
            </div>
            <div>
              <p className="text-muted-foreground">订单号</p>
              <p className="break-all">{intent.outTradeNo}</p>
            </div>
            <div>
              <p className="text-muted-foreground">金额</p>
              <p>{formatAmount(intent.amount, intent.currency)}</p>
            </div>
          </div>

          {intent.displayMode === "qrcode" && qrPreviewUrl ? (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-6">
              <QrCode className="h-6 w-6 text-muted-foreground" />
              {/* biome-ignore lint/performance/noImgElement: 当前只需要直接渲染外部二维码图片 */}
              <img
                src={qrPreviewUrl}
                alt="支付二维码"
                className="h-60 w-60 rounded-lg border bg-white p-3"
              />
              <p className="text-center text-sm text-muted-foreground">
                请使用微信扫一扫完成支付
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {intent.qrCodeUrl}
              </p>
            </div>
          ) : null}

          {intent.displayMode === "redirect" && intent.checkoutUrl ? (
            <div className="rounded-xl border p-4 text-sm text-muted-foreground">
              {redirecting
                ? "正在跳转到支付页，如果浏览器拦截了跳转，请点击下方按钮继续"
                : "点击下方按钮继续付款"}
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          {intent.checkoutUrl ? (
            <Button asChild>
              <a href={intent.checkoutUrl} target="_blank" rel="noreferrer">
                继续支付
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新状态
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/dashboard/credits/buy")}
          >
            返回购买页
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function resolveProviderLabel(provider: string) {
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

function resolveStatusLabel(status: string) {
  switch (status) {
    case "paid":
      return "已支付";
    case "pending":
      return "待支付";
    case "closed":
      return "已关闭";
    case "failed":
      return "失败";
    default:
      return "创建中";
  }
}

function formatAmount(amount: number, currency: string) {
  if (currency === "CNY") {
    return `¥${(amount / 100).toFixed(2)}`;
  }
  return `$${(amount / 100).toFixed(2)}`;
}
