import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAIGatewayAdminPageData,
  getAIGatewayOverview,
} from "@/features/ai-gateway";

/**
 * AI 管理后台页面。
 */
export default async function AdminAIGatewayPage() {
  const [overview, pageData] = await Promise.all([
    getAIGatewayOverview(),
    getAIGatewayAdminPageData(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI 网关</h2>
        <p className="text-sm text-muted-foreground">
          统一查看中转站、计费规则、模型绑定和请求明细。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard title="总请求数" value={overview.totalRequests} />
        <OverviewCard title="成功请求" value={overview.successRequests} />
        <OverviewCard title="总成本" value={overview.totalProviderCostMicros} suffix=" 微美元" />
        <OverviewCard title="总扣费" value={overview.totalChargedCredits} suffix=" 积分" />
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pageData.providers.map((provider) => (
              <div
                key={provider.id}
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{provider.name}</div>
                    <div className="text-muted-foreground">{provider.key}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={provider.enabled ? "default" : "secondary"}>
                      {provider.enabled ? "启用" : "停用"}
                    </Badge>
                    <Badge variant="outline">{provider.lastHealthStatus}</Badge>
                  </div>
                </div>
                <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                  <span>优先级：{provider.priority}</span>
                  <span>权重：{provider.weight}</span>
                  <span>尝试数：{provider.totalAttempts}</span>
                  <span>平均延迟：{provider.averageLatencyMs.toFixed(0)} ms</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近请求</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pageData.requests.map((request) => (
              <div key={request.requestId} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">
                    {request.toolKey} / {request.featureKey}
                  </div>
                  <Badge
                    variant={request.status === "success" ? "default" : "secondary"}
                  >
                    {request.status}
                  </Badge>
                </div>
                <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                  <span>用户：{request.userEmail}</span>
                  <span>Provider：{request.providerKey ?? "未命中"}</span>
                  <span>模型：{request.resolvedModel ?? request.requestedModel ?? "-"}</span>
                  <span>扣费：{request.chargedCredits ?? 0} 积分</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Model Binding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pageData.bindings.map((binding) => (
              <div key={binding.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">
                    {binding.modelKey} → {binding.modelAlias}
                  </div>
                  <Badge variant={binding.enabled ? "default" : "secondary"}>
                    {binding.enabled ? "启用" : "停用"}
                  </Badge>
                </div>
                <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                  <span>Provider：{binding.providerName}</span>
                  <span>超时：{binding.timeoutMs} ms</span>
                  <span>输入成本：{binding.inputCostPer1k}</span>
                  <span>输出成本：{binding.outputCostPer1k}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pageData.pricingRules.map((rule) => (
              <div key={rule.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">
                    {rule.toolKey} / {rule.featureKey}
                  </div>
                  <Badge variant={rule.enabled ? "default" : "secondary"}>
                    {rule.billingMode}
                  </Badge>
                </div>
                <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                  <span>模型范围：{rule.modelScope}</span>
                  <span>最低扣费：{rule.minimumCredits}</span>
                  <span>固定积分：{rule.fixedCredits ?? "-"}</span>
                  <span>每积分成本：{rule.costUsdPerCredit ?? "-"}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/**
 * 概览卡片。
 */
function OverviewCard(props: {
  title: string;
  value: number;
  suffix?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {props.value.toLocaleString()}
          {props.suffix ?? ""}
        </div>
      </CardContent>
    </Card>
  );
}
