"use client";

import {
  CircleHelp,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type OverviewData = {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  insufficientCredits: number;
  totalProviderCostMicros: number;
  totalChargedCredits: number;
};

type ProviderData = {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  weight: number;
  requestType: "chat";
  lastHealthStatus: string;
  totalAttempts: number;
  successAttempts: number;
  failedAttempts: number;
  averageLatencyMs: number;
  totalProviderCostMicros: number;
};

type BindingData = {
  id: string;
  providerId: string;
  providerKey: string;
  providerName: string;
  modelKey: string;
  modelAlias: string;
  capabilities: string[];
  enabled: boolean;
  priority: number;
  weight: number;
  costMode: "manual" | "fixed";
  inputCostPer1k: number;
  outputCostPer1k: number;
  fixedCostUsd: number;
  maxRetries: number;
  timeoutMs: number;
};

type PricingRuleData = {
  id: string;
  toolKey: string;
  featureKey: string;
  requestType: "chat";
  billingMode: "fixed_credits" | "token_based" | "cost_plus";
  modelScope: string;
  fixedCredits: number | null;
  inputTokensPerCredit: number | null;
  outputTokensPerCredit: number | null;
  costUsdPerCredit: number | null;
  minimumCredits: number;
  enabled: boolean;
};

type RequestData = {
  requestId: string;
  userEmail: string;
  userName: string;
  toolKey: string;
  featureKey: string;
  requestedModel: string | null;
  resolvedModel: string | null;
  status: string;
  billingMode: string;
  totalTokens: number | null;
  providerCostUsd: number | null;
  chargedCredits: number | null;
  attemptCount: number;
  providerKey: string | null;
  providerModel: string | null;
  errorMessage: string | null;
  createdAt: string | Date;
};

type AlertData = {
  providers: Array<{
    providerKey: string;
    healthStatus: string;
    failureRate: number;
    totalAttempts: number;
  }>;
  highCostRequests: Array<{
    requestId: string;
    toolKey: string;
    featureKey: string;
    providerCostUsd: number | null;
    createdAt: string | Date;
  }>;
};

type AdminAIGatewayViewProps = {
  initialOverview: OverviewData;
  initialProviders: ProviderData[];
  initialBindings: BindingData[];
  initialPricingRules: PricingRuleData[];
  initialRequests: RequestData[];
};

type ProviderFormState = {
  key: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: string;
  priority: string;
  weight: string;
};

type BindingFormState = {
  providerId: string;
  modelKey: string;
  modelAlias: string;
  capabilities: string[];
  enabled: string;
  priority: string;
  weight: string;
  costMode: "manual" | "fixed";
  inputCostPer1k: string;
  outputCostPer1k: string;
  fixedCostUsd: string;
  maxRetries: string;
  timeoutMs: string;
};

type PricingRuleFormState = {
  toolKey: string;
  featureKey: string;
  billingMode: "fixed_credits" | "token_based" | "cost_plus";
  modelScope: string;
  fixedCredits: string;
  inputTokensPerCredit: string;
  outputTokensPerCredit: string;
  costUsdPerCredit: string;
  minimumCredits: string;
  enabled: string;
};

type BillingAdjustmentFormState = {
  requestId: string;
  direction: "refund" | "charge";
  credits: string;
  reason: string;
};

const defaultProviderForm: ProviderFormState = {
  key: "",
  name: "",
  baseUrl: "",
  apiKey: "",
  enabled: "true",
  priority: "100",
  weight: "100",
};

const defaultBindingForm: BindingFormState = {
  providerId: "",
  modelKey: "",
  modelAlias: "",
  capabilities: ["text"],
  enabled: "true",
  priority: "100",
  weight: "100",
  costMode: "manual",
  inputCostPer1k: "0",
  outputCostPer1k: "0",
  fixedCostUsd: "0",
  maxRetries: "0",
  timeoutMs: "30000",
};

const defaultPricingRuleForm: PricingRuleFormState = {
  toolKey: "",
  featureKey: "",
  billingMode: "fixed_credits",
  modelScope: "any",
  fixedCredits: "",
  inputTokensPerCredit: "",
  outputTokensPerCredit: "",
  costUsdPerCredit: "",
  minimumCredits: "0",
  enabled: "true",
};

const defaultBillingAdjustmentForm: BillingAdjustmentFormState = {
  requestId: "",
  direction: "refund",
  credits: "",
  reason: "",
};

const AI_ADMIN_ACTIVE_TAB_STORAGE_KEY = "ai-admin-active-tab";
const AI_ADMIN_BINDING_FORM_STORAGE_KEY = "ai-admin-binding-form";
const AI_ADMIN_EDITING_BINDING_STORAGE_KEY = "ai-admin-editing-binding-id";

const AI_MODEL_CAPABILITY_OPTIONS = [
  { value: "text", label: "文本", description: "支持普通文本输入与输出" },
  {
    value: "image_input",
    label: "图片输入",
    description: "支持参考图、图片 URL、图片资产输入",
  },
  {
    value: "image_generation",
    label: "图片生成",
    description: "支持直接返回图片结果",
  },
  {
    value: "audio_input",
    label: "音频输入",
    description: "支持音频 URL、音频资产输入",
  },
  {
    value: "audio_generation",
    label: "音频生成",
    description: "支持语音或音频结果输出",
  },
  {
    value: "file_input",
    label: "文件输入",
    description: "支持文件 URL、文件资产输入",
  },
  {
    value: "video_input",
    label: "视频输入",
    description: "支持视频 URL、视频资产输入",
  },
  {
    value: "video_generation",
    label: "视频生成",
    description: "支持直接返回视频结果",
  },
] as const;

/**
 * AI 管理台客户端视图。
 */
export function AdminAIGatewayView(props: AdminAIGatewayViewProps) {
  const [overview, setOverview] = useState(props.initialOverview);
  const [providers, setProviders] = useState(props.initialProviders);
  const [bindings, setBindings] = useState(props.initialBindings);
  const [pricingRules, setPricingRules] = useState(props.initialPricingRules);
  const [requests, setRequests] = useState(props.initialRequests);
  const [alerts, setAlerts] = useState<AlertData | null>(null);
  const [providerForm, setProviderForm] = useState(defaultProviderForm);
  const [bindingForm, setBindingForm] = useState<BindingFormState>(() =>
    readSessionStorageJson(
      AI_ADMIN_BINDING_FORM_STORAGE_KEY,
      defaultBindingForm,
      isBindingFormState
    )
  );
  const [pricingRuleForm, setPricingRuleForm] = useState(
    defaultPricingRuleForm
  );
  const [billingAdjustmentForm, setBillingAdjustmentForm] = useState(
    defaultBillingAdjustmentForm
  );
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null
  );
  const [editingBindingId, setEditingBindingId] = useState<string | null>(() =>
    readSessionStorageJson(
      AI_ADMIN_EDITING_BINDING_STORAGE_KEY,
      null,
      (value): value is string | null =>
        value === null || typeof value === "string"
    )
  );
  const [editingPricingRuleId, setEditingPricingRuleId] = useState<
    string | null
  >(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(() =>
    readSessionStorageTab(AI_ADMIN_ACTIVE_TAB_STORAGE_KEY)
  );

  /**
   * 持久化当前 Tab，避免页面重挂载后跳回默认页签。
   */
  useEffect(() => {
    writeSessionStorageValue(AI_ADMIN_ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  /**
   * 持久化模型绑定表单草稿，避免开发环境整页刷新时输入丢失。
   */
  useEffect(() => {
    writeSessionStorageValue(AI_ADMIN_BINDING_FORM_STORAGE_KEY, bindingForm);
  }, [bindingForm]);

  /**
   * 持久化当前编辑中的模型绑定 id，保证刷新后仍能续填。
   */
  useEffect(() => {
    if (!editingBindingId) {
      clearSessionStorageValue(AI_ADMIN_EDITING_BINDING_STORAGE_KEY);
      return;
    }
    writeSessionStorageValue(
      AI_ADMIN_EDITING_BINDING_STORAGE_KEY,
      editingBindingId
    );
  }, [editingBindingId]);

  /**
   * 刷新整个管理台数据。
   */
  const refreshAll = async () => {
    setLoadingKey("refresh-all");
    try {
      const [
        summaryResponse,
        providersResponse,
        bindingsResponse,
        rulesResponse,
        requestsResponse,
      ] = await Promise.all([
        fetch("/api/platform/ai/summary", { credentials: "include" }),
        fetch("/api/platform/ai/admin/providers", { credentials: "include" }),
        fetch("/api/platform/ai/admin/model-bindings", {
          credentials: "include",
        }),
        fetch("/api/platform/ai/admin/pricing-rules", {
          credentials: "include",
        }),
        fetch("/api/platform/ai/admin/requests?limit=20", {
          credentials: "include",
        }),
      ]);

      const [summary, providerList, bindingList, ruleList, requestList] =
        await Promise.all([
          parseResponse<{ overview: OverviewData }>(summaryResponse),
          parseResponse<{ providers: ProviderData[] }>(providersResponse),
          parseResponse<{ bindings: BindingData[] }>(bindingsResponse),
          parseResponse<{ pricingRules: PricingRuleData[] }>(rulesResponse),
          parseResponse<{ requests: RequestData[] }>(requestsResponse),
        ]);

      setOverview(summary.overview);
      setProviders(providerList.providers);
      setBindings(bindingList.bindings);
      setPricingRules(ruleList.pricingRules);
      setRequests(requestList.requests);
      toast.success("AI 管理数据已刷新");
    } catch (error) {
      toast.error(getErrorMessage(error, "刷新失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 提交 Provider 表单。
   */
  const submitProvider = async () => {
    setLoadingKey("provider-submit");
    try {
      const body = {
        key: providerForm.key.trim(),
        name: providerForm.name.trim(),
        baseUrl: providerForm.baseUrl.trim(),
        ...(providerForm.apiKey.trim()
          ? { apiKey: providerForm.apiKey.trim() }
          : {}),
        enabled: providerForm.enabled === "true",
        priority: toNumber(providerForm.priority),
        weight: toNumber(providerForm.weight),
        requestType: "chat" as const,
      };

      const response = await fetch(
        editingProviderId
          ? `/api/platform/ai/admin/providers/${editingProviderId}`
          : "/api/platform/ai/admin/providers",
        {
          method: editingProviderId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );

      await parseResponse(response);
      toast.success(editingProviderId ? "Provider 已更新" : "Provider 已创建");
      setProviderForm(defaultProviderForm);
      setEditingProviderId(null);
      await refreshProviderAndSummary();
    } catch (error) {
      toast.error(getErrorMessage(error, "Provider 保存失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 提交 Binding 表单。
   */
  const submitBinding = async () => {
    setLoadingKey("binding-submit");
    try {
      const body = {
        providerId: bindingForm.providerId,
        modelKey: bindingForm.modelKey.trim(),
        modelAlias: bindingForm.modelAlias.trim(),
        capabilities: bindingForm.capabilities,
        enabled: bindingForm.enabled === "true",
        priority: toNumber(bindingForm.priority),
        weight: toNumber(bindingForm.weight),
        costMode: bindingForm.costMode,
        inputCostPer1k: toNumber(bindingForm.inputCostPer1k),
        outputCostPer1k: toNumber(bindingForm.outputCostPer1k),
        fixedCostUsd: toNumber(bindingForm.fixedCostUsd),
        maxRetries: toNumber(bindingForm.maxRetries),
        timeoutMs: toNumber(bindingForm.timeoutMs),
      };

      const response = await fetch(
        editingBindingId
          ? `/api/platform/ai/admin/model-bindings/${editingBindingId}`
          : "/api/platform/ai/admin/model-bindings",
        {
          method: editingBindingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );

      await parseResponse(response);
      toast.success(editingBindingId ? "模型绑定已更新" : "模型绑定已创建");
      setBindingForm(defaultBindingForm);
      setEditingBindingId(null);
      clearBindingDraft();
      await refreshBindings();
    } catch (error) {
      toast.error(getErrorMessage(error, "模型绑定保存失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 提交计费规则表单。
   */
  const submitPricingRule = async () => {
    setLoadingKey("pricing-submit");
    try {
      const body = {
        toolKey: pricingRuleForm.toolKey.trim(),
        featureKey: pricingRuleForm.featureKey.trim(),
        requestType: "chat" as const,
        billingMode: pricingRuleForm.billingMode,
        modelScope: pricingRuleForm.modelScope.trim(),
        fixedCredits: toNullableNumber(pricingRuleForm.fixedCredits),
        inputTokensPerCredit: toNullableNumber(
          pricingRuleForm.inputTokensPerCredit
        ),
        outputTokensPerCredit: toNullableNumber(
          pricingRuleForm.outputTokensPerCredit
        ),
        costUsdPerCredit: toNullableNumber(pricingRuleForm.costUsdPerCredit),
        minimumCredits: toNumber(pricingRuleForm.minimumCredits),
        enabled: pricingRuleForm.enabled === "true",
      };

      const response = await fetch(
        editingPricingRuleId
          ? `/api/platform/ai/admin/pricing-rules/${editingPricingRuleId}`
          : "/api/platform/ai/admin/pricing-rules",
        {
          method: editingPricingRuleId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );

      await parseResponse(response);
      toast.success(editingPricingRuleId ? "计费规则已更新" : "计费规则已创建");
      setPricingRuleForm(defaultPricingRuleForm);
      setEditingPricingRuleId(null);
      await refreshPricingRules();
    } catch (error) {
      toast.error(getErrorMessage(error, "计费规则保存失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 执行 Provider 健康检查。
   */
  const runHealthCheck = async (providerIds?: string[]) => {
    setLoadingKey(providerIds?.[0] ?? "health-check");
    try {
      const response = await fetch(
        "/api/platform/ai/admin/providers/health-check",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ...(providerIds ? { providerIds } : {}),
            disableOnFailure: true,
          }),
        }
      );

      const data = await parseResponse<{ results: Array<unknown> }>(response);
      toast.success(`健康检查完成，共 ${data.results.length} 条结果`);
      await refreshProviderAndSummary();
    } catch (error) {
      toast.error(getErrorMessage(error, "健康检查失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 执行手工调账。
   */
  const submitBillingAdjustment = async () => {
    setLoadingKey("billing-adjustment");
    try {
      const response = await fetch(
        "/api/platform/ai/admin/billing-adjustments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            requestId: billingAdjustmentForm.requestId.trim(),
            direction: billingAdjustmentForm.direction,
            credits: toNumber(billingAdjustmentForm.credits),
            reason: billingAdjustmentForm.reason.trim(),
          }),
        }
      );

      await parseResponse(response);
      toast.success("调账已提交");
      setBillingAdjustmentForm(defaultBillingAdjustmentForm);
      await refreshAll();
    } catch (error) {
      toast.error(getErrorMessage(error, "调账失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 删除指定资源。
   */
  const deleteResource = async (url: string, successMessage: string) => {
    setLoadingKey(url);
    try {
      const response = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      await parseResponse(response);
      toast.success(successMessage);
      await refreshAll();
    } catch (error) {
      toast.error(getErrorMessage(error, "删除失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 拉取最新告警数据。
   */
  const fetchAlerts = async () => {
    setLoadingKey("alerts");
    try {
      const response = await fetch(
        "/api/platform/ai/admin/alerts?costAlertMicros=1&failureRateThreshold=0.5",
        { credentials: "include" }
      );
      const data = await parseResponse<{ alerts: AlertData }>(response);
      setAlerts(data.alerts);
      toast.success("告警数据已刷新");
    } catch (error) {
      toast.error(getErrorMessage(error, "告警刷新失败"));
    } finally {
      setLoadingKey(null);
    }
  };

  /**
   * 仅刷新 Provider 和总览。
   */
  const refreshProviderAndSummary = async () => {
    const [summaryResponse, providersResponse] = await Promise.all([
      fetch("/api/platform/ai/summary", { credentials: "include" }),
      fetch("/api/platform/ai/admin/providers", { credentials: "include" }),
    ]);
    const summaryData = await parseResponse<{ overview: OverviewData }>(
      summaryResponse
    );
    const providersData = await parseResponse<{ providers: ProviderData[] }>(
      providersResponse
    );
    setOverview(summaryData.overview);
    setProviders(providersData.providers);
  };

  /**
   * 刷新模型绑定列表。
   */
  const refreshBindings = async () => {
    const response = await fetch("/api/platform/ai/admin/model-bindings", {
      credentials: "include",
    });
    const data = await parseResponse<{ bindings: BindingData[] }>(response);
    setBindings(data.bindings);
  };

  /**
   * 刷新计费规则列表。
   */
  const refreshPricingRules = async () => {
    const response = await fetch("/api/platform/ai/admin/pricing-rules", {
      credentials: "include",
    });
    const data = await parseResponse<{ pricingRules: PricingRuleData[] }>(
      response
    );
    setPricingRules(data.pricingRules);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">AI 网关</h2>
          <p className="text-sm text-muted-foreground">
            直接在后台维护中转站、模型绑定、计费规则和运维动作。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => startTransition(() => void refreshAll())}
          disabled={loadingKey === "refresh-all"}
        >
          {loadingKey === "refresh-all" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新全部
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard title="总请求数" value={overview.totalRequests} />
        <OverviewCard title="成功请求" value={overview.successRequests} />
        <OverviewCard title="失败请求" value={overview.failedRequests} />
        <OverviewCard
          title="总扣费"
          value={overview.totalChargedCredits}
          suffix=" 积分"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList className="flex h-auto flex-wrap gap-2 bg-transparent p-0">
          <TabsTrigger value="providers">Provider</TabsTrigger>
          <TabsTrigger value="bindings">模型绑定</TabsTrigger>
          <TabsTrigger value="pricing">计费规则</TabsTrigger>
          <TabsTrigger value="requests">请求明细</TabsTrigger>
          <TabsTrigger value="ops">运维</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingProviderId ? "编辑 Provider" : "新增 Provider"}
              </CardTitle>
              <CardDescription>
                维护上游中转站信息和基础路由参数。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field
                label="Provider Key"
                info="平台内部使用的唯一标识。建议使用稳定英文名，例如 geek-default、yunwu-main。工具配置和日志里会引用这个值。"
              >
                <Input
                  value={providerForm.key}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      key: event.target.value,
                    }))
                  }
                  placeholder="geek-default"
                />
              </Field>
              <Field
                label="名称"
                info="后台展示名称，给管理员识别用。可以填更易读的名字，例如 Geek 主线路由、云雾备用线路。"
              >
                <Input
                  value={providerForm.name}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Geek Default"
                />
              </Field>
              <Field
                label="Base URL"
                info="上游中转站的 OpenAI 兼容基础地址，一般以 /v1 结尾，例如 https://your-provider.example.com/v1。"
              >
                <Input
                  value={providerForm.baseUrl}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://example.com/v1"
                />
              </Field>
              <Field
                label="API Key"
                info="当前 provider 使用的上游密钥。编辑时留空表示保留原密钥，不会覆盖。"
              >
                <Input
                  value={providerForm.apiKey}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={editingProviderId ? "留空表示不覆盖" : "sk-xxx"}
                />
              </Field>
              <Field
                label="启用状态"
                info="启用后这个 provider 才会参与路由；停用后不会再接收新请求。"
              >
                <Select
                  value={providerForm.enabled}
                  onValueChange={(value) =>
                    setProviderForm((current) => ({
                      ...current,
                      enabled: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">启用</SelectItem>
                    <SelectItem value="false">停用</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="优先级"
                info="数值越小越优先。`priority_failover` 路由策略下会优先选择优先级更小的 provider。"
              >
                <Input
                  value={providerForm.priority}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="权重"
                info="主要用于 `weighted` 路由策略。数值越大，被选中的概率越高。当前如果主要用主备切换，可以先保持默认值。"
              >
                <Input
                  value={providerForm.weight}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      weight: event.target.value,
                    }))
                  }
                />
              </Field>
            </CardContent>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => startTransition(() => void submitProvider())}
                disabled={loadingKey === "provider-submit"}
                loading={loadingKey === "provider-submit"}
                loadingText={
                  editingProviderId
                    ? "保存 Provider 中..."
                    : "新增 Provider 中..."
                }
              >
                {editingProviderId ? "保存 Provider" : "新增 Provider"}
              </Button>
              {editingProviderId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingProviderId(null);
                    setProviderForm(defaultProviderForm);
                  }}
                >
                  取消编辑
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => startTransition(() => void runHealthCheck())}
                disabled={loadingKey === "health-check"}
              >
                执行全部健康检查
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider 列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {providers.map((provider) => (
                <div key={provider.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{provider.name}</span>
                        <Badge
                          variant={provider.enabled ? "default" : "secondary"}
                        >
                          {provider.enabled ? "启用" : "停用"}
                        </Badge>
                        <Badge variant="outline">
                          {provider.lastHealthStatus}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {provider.key} · {provider.baseUrl}
                      </div>
                      <div className="grid gap-1 text-sm text-muted-foreground md:grid-cols-2">
                        <span>优先级：{provider.priority}</span>
                        <span>权重：{provider.weight}</span>
                        <span>尝试数：{provider.totalAttempts}</span>
                        <span>
                          平均延迟：{provider.averageLatencyMs.toFixed(0)} ms
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingProviderId(provider.id);
                          setProviderForm({
                            key: provider.key,
                            name: provider.name,
                            baseUrl: provider.baseUrl,
                            apiKey: "",
                            enabled: String(provider.enabled),
                            priority: String(provider.priority),
                            weight: String(provider.weight),
                          });
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          startTransition(
                            () => void runHealthCheck([provider.id])
                          )
                        }
                        disabled={loadingKey === provider.id}
                      >
                        健康检查
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() =>
                          startTransition(
                            () =>
                              void deleteResource(
                                `/api/platform/ai/admin/providers/${provider.id}`,
                                "Provider 已删除"
                              )
                          )
                        }
                        disabled={
                          loadingKey ===
                          `/api/platform/ai/admin/providers/${provider.id}`
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bindings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingBindingId ? "编辑模型绑定" : "新增模型绑定"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field
                label="Provider"
                info="选择这条模型绑定属于哪个上游中转站。一个平台模型可以绑定到多个 provider。"
              >
                <Select
                  value={bindingForm.providerId}
                  onValueChange={(value) =>
                    setBindingForm((current) => ({
                      ...current,
                      providerId: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="平台模型名"
                info="平台内部统一模型名。工具请求时填写的是这个值，例如 gpt-4o-mini。"
              >
                <Input
                  value={bindingForm.modelKey}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      modelKey: event.target.value,
                    }))
                  }
                  placeholder="gpt-4o-mini"
                />
              </Field>
              <Field
                label="上游模型别名"
                info="真正发给上游 provider 的模型名。如果上游和平台模型名一致，可以填相同值。"
              >
                <Input
                  value={bindingForm.modelAlias}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      modelAlias: event.target.value,
                    }))
                  }
                  placeholder="gpt-4o-mini"
                />
              </Field>
              <Field
                label="能力声明"
                info="直接勾选模型已确认支持的能力。图片生成模型至少要声明图片生成，支持参考图还应声明图片输入。"
                className="md:col-span-2 xl:col-span-3"
              >
                <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {AI_MODEL_CAPABILITY_OPTIONS.map((option) => {
                      const inputId = `binding-capability-${option.value}`;
                      const checked = bindingForm.capabilities.includes(
                        option.value
                      );
                      return (
                        <label
                          key={option.value}
                          htmlFor={inputId}
                          className="flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/20"
                        >
                          <Checkbox
                            id={inputId}
                            className="mt-0.5"
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              setBindingForm((current) => ({
                                ...current,
                                capabilities: nextChecked
                                  ? [...current.capabilities, option.value]
                                  : current.capabilities.filter(
                                      (item) => item !== option.value
                                    ),
                              }))
                            }
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-sm font-medium">
                              {option.label}
                            </div>
                            <div className="text-sm leading-6 text-muted-foreground">
                              {option.description}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </Field>
              <Field
                label="成本模式"
                info="`manual` 表示按输入/输出 token 成本计算真实上游成本；`fixed` 表示每次请求按固定成本记账。多数文本模型建议用 manual，只有上游按次收费时才用 fixed。"
              >
                <Select
                  value={bindingForm.costMode}
                  onValueChange={(value: "manual" | "fixed") =>
                    setBindingForm((current) => ({
                      ...current,
                      costMode: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">manual</SelectItem>
                    <SelectItem value="fixed">fixed</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="输入成本"
                info="每 1000 个输入 token 的成本，单位是微美元。1 美元 = 1000000 微美元。比如 0.00015 美元可填写 150。"
              >
                <Input
                  value={bindingForm.inputCostPer1k}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      inputCostPer1k: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="输出成本"
                info="每 1000 个输出 token 的成本，单位是微美元。文本模型通常输出成本高于输入成本。"
              >
                <Input
                  value={bindingForm.outputCostPer1k}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      outputCostPer1k: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="固定成本"
                info="仅在成本模式为 fixed 时生效，表示每次请求固定记多少微美元成本。"
              >
                <Input
                  value={bindingForm.fixedCostUsd}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      fixedCostUsd: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="优先级"
                info="同一模型在多个 provider 下的排序，数值越小越先尝试。"
              >
                <Input
                  value={bindingForm.priority}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="权重" info="同一模型在 weighted 路由中的选择权重。">
                <Input
                  value={bindingForm.weight}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      weight: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="重试次数"
                info="单个绑定内部允许的重试次数。当前平台以 provider 回退为主，这里通常保持 0。"
              >
                <Input
                  value={bindingForm.maxRetries}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      maxRetries: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="超时毫秒"
                info="调用这个 provider-model 组合时的超时阈值。常见范围是 10000 到 60000 毫秒。"
              >
                <Input
                  value={bindingForm.timeoutMs}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      timeoutMs: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="启用状态"
                info="停用后这条模型绑定不会参与路由，但 provider 本身还可以继续服务其他模型。"
              >
                <Select
                  value={bindingForm.enabled}
                  onValueChange={(value) =>
                    setBindingForm((current) => ({
                      ...current,
                      enabled: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">启用</SelectItem>
                    <SelectItem value="false">停用</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => startTransition(() => void submitBinding())}
                disabled={loadingKey === "binding-submit"}
                loading={loadingKey === "binding-submit"}
                loadingText={
                  editingBindingId ? "保存模型绑定中..." : "新增模型绑定中..."
                }
              >
                {editingBindingId ? "保存模型绑定" : "新增模型绑定"}
              </Button>
              {editingBindingId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingBindingId(null);
                    setBindingForm(defaultBindingForm);
                    clearBindingDraft();
                  }}
                >
                  取消编辑
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>模型绑定列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bindings.map((binding) => (
                <div key={binding.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {binding.modelKey} → {binding.modelAlias}
                        </span>
                        <Badge
                          variant={binding.enabled ? "default" : "secondary"}
                        >
                          {binding.enabled ? "启用" : "停用"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {binding.providerName} · 超时 {binding.timeoutMs} ms
                      </div>
                      <div className="text-sm text-muted-foreground">
                        能力: {binding.capabilities.join(", ")}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingBindingId(binding.id);
                          setBindingForm({
                            providerId: binding.providerId,
                            modelKey: binding.modelKey,
                            modelAlias: binding.modelAlias,
                            capabilities: binding.capabilities,
                            enabled: String(binding.enabled),
                            priority: String(binding.priority),
                            weight: String(binding.weight),
                            costMode: binding.costMode,
                            inputCostPer1k: String(binding.inputCostPer1k),
                            outputCostPer1k: String(binding.outputCostPer1k),
                            fixedCostUsd: String(binding.fixedCostUsd),
                            maxRetries: String(binding.maxRetries),
                            timeoutMs: String(binding.timeoutMs),
                          });
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() =>
                          startTransition(
                            () =>
                              void deleteResource(
                                `/api/platform/ai/admin/model-bindings/${binding.id}`,
                                "模型绑定已删除"
                              )
                          )
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingPricingRuleId ? "编辑计费规则" : "新增计费规则"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field
                label="工具标识"
                info="计费规则所属工具，例如 redink、jingfang-ai。必须和工具调用 /api/platform/ai/chat 时传入的 tool 一致。"
              >
                <Input
                  value={pricingRuleForm.toolKey}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      toolKey: event.target.value,
                    }))
                  }
                  placeholder="redink"
                />
              </Field>
              <Field
                label="功能标识"
                info="计费规则所属功能，例如 rewrite、summary。必须和接口里的 feature 一致。"
              >
                <Input
                  value={pricingRuleForm.featureKey}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      featureKey: event.target.value,
                    }))
                  }
                  placeholder="rewrite"
                />
              </Field>
              <Field
                label="计费模式"
                info="`fixed_credits` 表示固定扣积分；`token_based` 表示按输入输出 token 换算积分；`cost_plus` 表示先算平台真实成本，再按成本比例换算积分。大多数面向用户的功能先用 fixed_credits，成本波动大的功能再用 token_based 或 cost_plus。"
              >
                <Select
                  value={pricingRuleForm.billingMode}
                  onValueChange={(
                    value: "fixed_credits" | "token_based" | "cost_plus"
                  ) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      billingMode: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_credits">fixed_credits</SelectItem>
                    <SelectItem value="token_based">token_based</SelectItem>
                    <SelectItem value="cost_plus">cost_plus</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="模型范围"
                info="填写 any 表示所有模型都生效；也可以填写具体平台模型名，只让某个模型命中这条计费规则。"
              >
                <Input
                  value={pricingRuleForm.modelScope}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      modelScope: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="固定积分"
                info="只有计费模式为 fixed_credits 时需要填写，表示每次成功请求固定扣多少积分。"
              >
                <Input
                  value={pricingRuleForm.fixedCredits}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      fixedCredits: event.target.value,
                    }))
                  }
                  placeholder="固定扣费可填写"
                />
              </Field>
              <Field
                label="输入 token / 积分"
                info="只有 token_based 时需要填写，表示每多少输入 token 扣 1 积分。例如填 1000 表示 1000 输入 token = 1 积分。"
              >
                <Input
                  value={pricingRuleForm.inputTokensPerCredit}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      inputTokensPerCredit: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="输出 token / 积分"
                info="只有 token_based 时需要填写，表示每多少输出 token 扣 1 积分。"
              >
                <Input
                  value={pricingRuleForm.outputTokensPerCredit}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      outputTokensPerCredit: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="成本 / 积分"
                info="只有 cost_plus 时需要填写，单位是微美元。表示平台真实成本达到多少微美元时扣 1 积分。"
              >
                <Input
                  value={pricingRuleForm.costUsdPerCredit}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      costUsdPerCredit: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="最低扣费"
                info="本次请求最少扣多少积分。即使 token 或成本换算结果更低，也不会低于这个值。"
              >
                <Input
                  value={pricingRuleForm.minimumCredits}
                  onChange={(event) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      minimumCredits: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="启用状态"
                info="停用后这条计费规则不会再参与结算匹配。"
              >
                <Select
                  value={pricingRuleForm.enabled}
                  onValueChange={(value) =>
                    setPricingRuleForm((current) => ({
                      ...current,
                      enabled: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">启用</SelectItem>
                    <SelectItem value="false">停用</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => startTransition(() => void submitPricingRule())}
                disabled={loadingKey === "pricing-submit"}
                loading={loadingKey === "pricing-submit"}
                loadingText={
                  editingPricingRuleId
                    ? "保存计费规则中..."
                    : "新增计费规则中..."
                }
              >
                {editingPricingRuleId ? "保存计费规则" : "新增计费规则"}
              </Button>
              {editingPricingRuleId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingPricingRuleId(null);
                    setPricingRuleForm(defaultPricingRuleForm);
                  }}
                >
                  取消编辑
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>计费规则列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pricingRules.map((rule) => (
                <div key={rule.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {rule.toolKey} / {rule.featureKey}
                        </span>
                        <Badge variant={rule.enabled ? "default" : "secondary"}>
                          {rule.billingMode}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        模型范围 {rule.modelScope} · 最低扣费{" "}
                        {rule.minimumCredits}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingPricingRuleId(rule.id);
                          setPricingRuleForm({
                            toolKey: rule.toolKey,
                            featureKey: rule.featureKey,
                            billingMode: rule.billingMode,
                            modelScope: rule.modelScope,
                            fixedCredits: stringifyNullableNumber(
                              rule.fixedCredits
                            ),
                            inputTokensPerCredit: stringifyNullableNumber(
                              rule.inputTokensPerCredit
                            ),
                            outputTokensPerCredit: stringifyNullableNumber(
                              rule.outputTokensPerCredit
                            ),
                            costUsdPerCredit: stringifyNullableNumber(
                              rule.costUsdPerCredit
                            ),
                            minimumCredits: String(rule.minimumCredits),
                            enabled: String(rule.enabled),
                          });
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() =>
                          startTransition(
                            () =>
                              void deleteResource(
                                `/api/platform/ai/admin/pricing-rules/${rule.id}`,
                                "计费规则已删除"
                              )
                          )
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>最近请求</CardTitle>
              <CardDescription>
                这里可以直接看到工具调用后的平台结算结果。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {requests.map((request) => (
                <div key={request.requestId} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {request.toolKey} / {request.featureKey}
                        </span>
                        <Badge
                          variant={
                            request.status === "success"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        用户：{request.userEmail} · Provider：
                        {request.providerKey ?? "未命中"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        模型：
                        {request.resolvedModel ?? request.requestedModel ?? "-"}{" "}
                        · Token：{request.totalTokens ?? 0} · 扣费：
                        {request.chargedCredits ?? 0}
                      </div>
                      {request.errorMessage ? (
                        <div className="text-sm text-red-600">
                          {request.errorMessage}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(request.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ops" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>手工调账</CardTitle>
              <CardDescription>
                用请求 ID 发起补扣或退款，不需要再手工调用接口。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field
                label="请求 ID"
                info="要调账的 AI 请求编号。可以从请求明细里直接复制。"
              >
                <Input
                  value={billingAdjustmentForm.requestId}
                  onChange={(event) =>
                    setBillingAdjustmentForm((current) => ({
                      ...current,
                      requestId: event.target.value,
                    }))
                  }
                  placeholder="air_xxx"
                />
              </Field>
              <Field
                label="调账方向"
                info="refund 表示退积分给用户；charge 表示补扣积分。"
              >
                <Select
                  value={billingAdjustmentForm.direction}
                  onValueChange={(value: "refund" | "charge") =>
                    setBillingAdjustmentForm((current) => ({
                      ...current,
                      direction: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="refund">refund</SelectItem>
                    <SelectItem value="charge">charge</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="积分数量"
                info="本次调账的积分数量，必须是正整数。方向由上一个字段决定。"
              >
                <Input
                  value={billingAdjustmentForm.credits}
                  onChange={(event) =>
                    setBillingAdjustmentForm((current) => ({
                      ...current,
                      credits: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="调账原因"
                info="记录本次调账原因，便于后续核账和审计。建议写清楚背景，例如“上游异常退款”或“人工补扣”。"
              >
                <Textarea
                  value={billingAdjustmentForm.reason}
                  onChange={(event) =>
                    setBillingAdjustmentForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  rows={4}
                />
              </Field>
            </CardContent>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() =>
                  startTransition(() => void submitBillingAdjustment())
                }
                disabled={loadingKey === "billing-adjustment"}
              >
                提交调账
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => startTransition(() => void fetchAlerts())}
                disabled={loadingKey === "alerts"}
              >
                <ShieldAlert className="mr-2 h-4 w-4" />
                刷新告警
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>运维告警</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Provider 告警</div>
                {alerts?.providers?.length ? (
                  alerts.providers.map((item) => (
                    <div
                      key={item.providerKey}
                      className="rounded-lg border p-3 text-sm"
                    >
                      {item.providerKey} · 状态 {item.healthStatus} · 失败率{" "}
                      {(item.failureRate * 100).toFixed(1)}% · 总尝试{" "}
                      {item.totalAttempts}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    暂无 provider 告警
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">高成本请求</div>
                {alerts?.highCostRequests?.length ? (
                  alerts.highCostRequests.map((item) => (
                    <div
                      key={item.requestId}
                      className="rounded-lg border p-3 text-sm"
                    >
                      {item.requestId} · {item.toolKey}/{item.featureKey} · 成本{" "}
                      {item.providerCostUsd ?? 0} 微美元 ·{" "}
                      {formatDateTime(item.createdAt)}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    暂无高成本请求
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );

  /**
   * 清理模型绑定草稿，提交成功或手动取消后不再恢复旧值。
   */
  function clearBindingDraft() {
    clearSessionStorageValue(AI_ADMIN_BINDING_FORM_STORAGE_KEY);
    clearSessionStorageValue(AI_ADMIN_EDITING_BINDING_STORAGE_KEY);
  }
}

/**
 * 统一表单字段包装。
 */
function Field(props: {
  label: string;
  info?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", props.className)}>
      <Label className="space-y-2">
        <span className="flex items-center gap-2">
          <span>{props.label}</span>
          {props.info ? <InfoTip content={props.info} /> : null}
        </span>
        {props.children}
      </Label>
    </div>
  );
}

/**
 * 字段说明提示。
 */
function InfoTip(props: { content: string }) {
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        aria-label="查看字段说明"
      >
        {/* 直接使用默认触发器，避免 asChild 对单子节点的限制 */}
        <span className="contents">
          <CircleHelp className="h-4 w-4" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs leading-6">
        {props.content}
      </PopoverContent>
    </Popover>
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

/**
 * 从 sessionStorage 读取字符串。
 */
function readSessionStorageString(key: string) {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(key);
}

/**
 * 从 sessionStorage 读取 JSON，并在校验失败时回退默认值。
 */
function readSessionStorageJson<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T
) {
  const rawValue = readSessionStorageString(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    return isValid(parsedValue) ? parsedValue : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 读取 AI 管理页当前激活的 Tab。
 */
function readSessionStorageTab(key: string) {
  const value = readSessionStorageJson(
    key,
    "providers",
    (current): current is string => typeof current === "string"
  );
  return value && AI_ADMIN_TABS.has(value) ? value : "providers";
}

/**
 * 写入 sessionStorage。
 */
function writeSessionStorageValue(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

/**
 * 清理 sessionStorage 中的指定键。
 */
function clearSessionStorageValue(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(key);
}

const AI_ADMIN_TABS = new Set([
  "providers",
  "bindings",
  "pricing",
  "requests",
  "ops",
]);

/**
 * 校验模型绑定草稿结构，避免旧缓存污染当前表单。
 */
function isBindingFormState(value: unknown): value is BindingFormState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.providerId === "string" &&
    typeof candidate.modelKey === "string" &&
    typeof candidate.modelAlias === "string" &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every((item) => typeof item === "string") &&
    typeof candidate.enabled === "string" &&
    typeof candidate.priority === "string" &&
    typeof candidate.weight === "string" &&
    (candidate.costMode === "manual" || candidate.costMode === "fixed") &&
    typeof candidate.inputCostPer1k === "string" &&
    typeof candidate.outputCostPer1k === "string" &&
    typeof candidate.fixedCostUsd === "string" &&
    typeof candidate.maxRetries === "string" &&
    typeof candidate.timeoutMs === "string"
  );
}

/**
 * 解析接口响应。
 */
async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as {
    success?: boolean;
    message?: string;
    error?: string;
    [key: string]: unknown;
  };

  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || "请求失败");
  }

  return data as T;
}

/**
 * 转换数字字符串。
 */
function toNumber(value: string) {
  return Number(value || 0);
}

/**
 * 转换可空数字字符串。
 */
function toNullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/**
 * 把可空数字转回表单字符串。
 */
function stringifyNullableNumber(value: number | null) {
  return value === null ? "" : String(value);
}

/**
 * 统一错误消息输出。
 */
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 格式化日期时间。
 */
function formatDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
