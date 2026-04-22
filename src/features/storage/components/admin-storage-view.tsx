"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveStoragePolicyAction } from "@/features/storage/actions";
import { saveAdminToolConfigAction } from "@/features/tool-config/actions";

type StorageAssetUrlMode = "public" | "proxy" | "signed";

type StoragePrefixRule = {
  prefix: string;
  retentionClass: "permanent" | "long_term" | "temporary" | "ephemeral";
  ttlHours?: number;
  purpose?: string;
  enabled?: boolean;
};

type AdminStorageViewProps = {
  data: {
    project: {
      key: string;
      name: string;
      revision: number;
    };
    config: {
      provider: string;
      vendor: string;
      endpoint: string;
      bucket: string;
      publicBaseUrl: string;
      cdnBaseUrl: string;
      appUrl: string;
      aiProxyBaseUrl: string;
      defaultAiUrlMode: StorageAssetUrlMode;
      uploadExpiresSeconds: number;
      ephemeralHours: number;
      temporaryDays: number;
      longTermDays: number;
      prefixRules: StoragePrefixRule[];
    };
    toolModes: Array<{
      toolKey: string;
      name: string;
      description: string | null;
      assetUrlMode: StorageAssetUrlMode;
    }>;
    summary: {
      totalObjects: number;
      readyObjects: number;
      pendingObjects: number;
      deletedObjects: number;
      expiredObjects: number;
      totalSizeBytes: number;
      permanentCount: number;
      longTermCount: number;
      temporaryCount: number;
      ephemeralCount: number;
    };
    cleanupCandidates: Array<{
      id: string;
      bucket: string;
      key: string;
      purpose: string;
      retentionClass: string;
      expiresAt: Date | string | null;
      status: string;
    }>;
    recentObjects: Array<{
      id: string;
      bucket: string;
      key: string;
      contentType: string;
      size: number | null;
      ownerUserId: string | null;
      ownerName: string | null;
      ownerEmail: string | null;
      toolKey: string | null;
      purpose: string;
      retentionClass: string;
      expiresAt: Date | null;
      requestId: string | null;
      taskId: string | null;
      status: string;
      metadata: Record<string, unknown> | null;
      deletedAt: Date | string | null;
      createdAt: Date | string;
      updatedAt: Date | string;
      links: {
        rawUrl: string;
        previewUrl: string;
        downloadUrl: string;
        previewable: boolean;
      };
    }>;
    recentPagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
};

type CleanupResult = {
  success: boolean;
  total: number;
  deleted: number;
  items: Array<{
    id: string;
    bucket: string;
    key: string;
    purpose: string;
    retentionClass: string;
    status: string;
  }>;
};

type ScopedCleanupResult = CleanupResult;
type RecentStorageObject =
  AdminStorageViewProps["data"]["recentObjects"][number];

/**
 * 管理员对象存储页面。
 */
export function AdminStorageView({ data }: AdminStorageViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [toolModes, setToolModes] = useState(() =>
    Object.fromEntries(
      data.toolModes.map((tool) => [tool.toolKey, tool.assetUrlMode])
    )
  );
  const [cleanupLimit, setCleanupLimit] = useState("20");
  const [cleanupLoading, setCleanupLoading] = useState<
    "dry-run" | "execute" | null
  >(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(
    null
  );
  const [scopedCleanupTarget, setScopedCleanupTarget] = useState({
    requestId: "",
    taskId: "",
  });
  const [scopedCleanupLoading, setScopedCleanupLoading] = useState<
    "dry-run" | "execute" | null
  >(null);
  const [scopedCleanupResult, setScopedCleanupResult] =
    useState<ScopedCleanupResult | null>(null);
  const [previewingObject, setPreviewingObject] =
    useState<RecentStorageObject | null>(null);
  const [storagePolicyForm, setStoragePolicyForm] = useState({
    ephemeralHours: String(data.config.ephemeralHours),
    temporaryDays: String(data.config.temporaryDays),
    longTermDays: String(data.config.longTermDays),
    prefixRules: JSON.stringify(data.config.prefixRules, null, 2),
  });
  const [savingToolKey, setSavingToolKey] = useState<string | null>(null);

  /**
   * 切换最近资源分页。
   */
  const jumpRecentPage = (page: number) => {
    const nextPage = Math.min(
      Math.max(page, 1),
      Math.max(data.recentPagination.totalPages, 1)
    );
    const next = new URLSearchParams(searchParams.toString());
    next.set("recentPage", String(nextPage));
    next.set("recentPageSize", String(data.recentPagination.pageSize));
    router.push(`${pathname}?${next.toString()}`);
  };

  /**
   * 打开资源预览弹窗。
   */
  const openPreview = (item: RecentStorageObject) => {
    setPreviewingObject(item);
  };

  // 用于保存单个工具的 AI 资源访问方式。
  const { execute: saveToolConfig } = useAction(saveAdminToolConfigAction, {
    onSuccess: ({ data: result }) => {
      toast.success(result?.message ?? "存储配置已保存");
      setSavingToolKey(null);
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "存储配置保存失败");
      setSavingToolKey(null);
    },
  });
  // 用于保存平台级对象存储策略。
  const { execute: saveStoragePolicy } = useAction(saveStoragePolicyAction, {
    onSuccess: ({ data: result }) => {
      toast.success(result?.message ?? "存储策略已保存");
      setSavingToolKey(null);
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "存储策略保存失败");
      setSavingToolKey(null);
    },
  });

  /**
   * 保存工具的资源访问方式。
   */
  const handleSaveToolMode = (toolKey: string) => {
    setSavingToolKey(toolKey);
    saveToolConfig({
      projectKey: data.project.key,
      tool: toolKey,
      values: {
        config10: toolModes[toolKey] ?? "public",
      },
      clearSecrets: [],
    });
  };

  /**
   * 保存平台级生命周期策略。
   */
  const handleSaveStoragePolicy = () => {
    try {
      setSavingToolKey("storage");
      saveStoragePolicy({
        projectKey: data.project.key,
        policy: {
          ephemeralHours: Number(storagePolicyForm.ephemeralHours),
          temporaryDays: Number(storagePolicyForm.temporaryDays),
          longTermDays: Number(storagePolicyForm.longTermDays),
          prefixRules: JSON.parse(
            storagePolicyForm.prefixRules
          ) as StoragePrefixRule[],
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "存储策略保存失败");
      setSavingToolKey(null);
    }
  };

  /**
   * 触发过期资源清理。
   */
  const runCleanup = async (dryRun: boolean) => {
    const limit = Math.min(Math.max(Number(cleanupLimit) || 20, 1), 200);
    setCleanupLoading(dryRun ? "dry-run" : "execute");

    try {
      const response = await fetch(
        "/api/platform/storage/admin/cleanup-expired",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            limit,
            dryRun,
          }),
        }
      );
      const result = (await response.json()) as CleanupResult & {
        error?: string;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message ?? result.error ?? "清理请求失败");
      }

      setCleanupResult(result);
      toast.success(
        dryRun
          ? `预检查完成，共发现 ${result.total} 条过期资源`
          : `清理完成，实际删除 ${result.deleted} 条资源`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清理请求失败");
    } finally {
      setCleanupLoading(null);
    }
  };

  /**
   * 按 requestId 或 taskId 清理整组资源。
   */
  const runScopedCleanup = async (dryRun: boolean) => {
    const requestId = scopedCleanupTarget.requestId.trim();
    const taskId = scopedCleanupTarget.taskId.trim();
    if (!requestId && !taskId) {
      toast.error("requestId 或 taskId 至少需要填写一个");
      return;
    }

    setScopedCleanupLoading(dryRun ? "dry-run" : "execute");

    try {
      const response = await fetch(
        "/api/platform/storage/admin/cleanup-scope",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(requestId ? { requestId } : {}),
            ...(taskId ? { taskId } : {}),
            dryRun,
          }),
        }
      );
      const result = (await response.json()) as ScopedCleanupResult & {
        error?: string;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message ?? result.error ?? "整组清理失败");
      }

      setScopedCleanupResult(result);
      toast.success(
        dryRun
          ? `整组预检查完成，共发现 ${result.total} 条资源`
          : `整组清理完成，实际删除 ${result.deleted} 条资源`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "整组清理失败");
    } finally {
      setScopedCleanupLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">对象存储</h2>
        <p className="text-muted-foreground">
          查看当前存储配置、按工具管理 AI 资源访问方式，并核对对象资源明细。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="资源总数"
          value={String(data.summary.totalObjects)}
          description={`ready ${data.summary.readyObjects} · pending ${data.summary.pendingObjects}`}
        />
        <SummaryCard
          title="待清理"
          value={String(data.summary.expiredObjects)}
          description="已过期但仍未删除的资源"
          danger={data.summary.expiredObjects > 0}
        />
        <SummaryCard
          title="总容量"
          value={formatBytes(data.summary.totalSizeBytes)}
          description={`已删除 ${data.summary.deletedObjects} 条`}
        />
        <SummaryCard
          title="项目版本"
          value={String(data.project.revision)}
          description={`${data.project.name} / ${data.project.key}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>运行时存储配置</CardTitle>
            <CardDescription>
              这里展示当前服务进程实际读取到的对象存储环境变量。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <ConfigItem label="Provider" value={data.config.provider} />
            <ConfigItem label="Vendor" value={data.config.vendor} />
            <ConfigItem label="Bucket" value={data.config.bucket} />
            <ConfigItem label="Endpoint" value={data.config.endpoint} />
            <ConfigItem label="公网地址" value={data.config.publicBaseUrl} />
            <ConfigItem label="CDN 地址" value={data.config.cdnBaseUrl} />
            <ConfigItem label="平台地址" value={data.config.appUrl} />
            <ConfigItem label="代理地址" value={data.config.aiProxyBaseUrl} />
            <ConfigItem
              label="默认 AI 模式"
              value={getModeLabel(data.config.defaultAiUrlMode)}
            />
            <ConfigItem
              label="上传签名"
              value={`${data.config.uploadExpiresSeconds} 秒`}
            />
            <ConfigItem
              label="短期保留"
              value={`${data.config.ephemeralHours} 小时`}
            />
            <ConfigItem
              label="临时保留"
              value={`${data.config.temporaryDays} 天`}
            />
            <ConfigItem
              label="长期保留"
              value={`${data.config.longTermDays} 天`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>保留等级分布</CardTitle>
            <CardDescription>
              用于核对长期资源、临时资源和请求级资源的占比。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "永久", value: data.summary.permanentCount },
              { label: "长期", value: data.summary.longTermCount },
              { label: "临时", value: data.summary.temporaryCount },
              { label: "短期", value: data.summary.ephemeralCount },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">
                  {item.label}
                </span>
                <span className="font-medium">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>生命周期后台策略</CardTitle>
          <CardDescription>
            这里的策略会直接影响新资源写入时的默认过期时间，并为云厂商生命周期规则提供前缀模板。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="policy-ephemeral-hours">短期资源保留小时</Label>
              <Input
                id="policy-ephemeral-hours"
                inputMode="numeric"
                value={storagePolicyForm.ephemeralHours}
                onChange={(event) =>
                  setStoragePolicyForm((current) => ({
                    ...current,
                    ephemeralHours: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-temporary-days">临时资源保留天数</Label>
              <Input
                id="policy-temporary-days"
                inputMode="numeric"
                value={storagePolicyForm.temporaryDays}
                onChange={(event) =>
                  setStoragePolicyForm((current) => ({
                    ...current,
                    temporaryDays: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-longterm-days">长期资源保留天数</Label>
              <Input
                id="policy-longterm-days"
                inputMode="numeric"
                value={storagePolicyForm.longTermDays}
                onChange={(event) =>
                  setStoragePolicyForm((current) => ({
                    ...current,
                    longTermDays: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="policy-prefix-rules">前缀生命周期规则 JSON</Label>
            <textarea
              id="policy-prefix-rules"
              className="min-h-[260px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={storagePolicyForm.prefixRules}
              onChange={(event) =>
                setStoragePolicyForm((current) => ({
                  ...current,
                  prefixRules: event.target.value,
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              每条规则支持
              `prefix`、`retentionClass`、`ttlHours`、`purpose`、`enabled`
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={savingToolKey === "storage"}
              loading={savingToolKey === "storage"}
              loadingText="保存生命周期策略中..."
              onClick={handleSaveStoragePolicy}
            >
              保存生命周期策略
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>按工具管理 AI 资源访问方式</CardTitle>
          <CardDescription>
            `public` 直接给 OSS 或公网地址，`proxy`
            通过平台接口回源。保存后对后续新请求立即生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {data.toolModes.map((tool) => (
            <div key={tool.toolKey} className="rounded-xl border p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{tool.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {tool.description || tool.toolKey}
                  </p>
                </div>
                <Badge variant="outline">{tool.toolKey}</Badge>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={`asset-mode-${tool.toolKey}`}>
                    资源访问方式
                  </Label>
                  <Select
                    value={toolModes[tool.toolKey] ?? tool.assetUrlMode}
                    onValueChange={(value) =>
                      setToolModes((current) => ({
                        ...current,
                        [tool.toolKey]: value as StorageAssetUrlMode,
                      }))
                    }
                  >
                    <SelectTrigger id={`asset-mode-${tool.toolKey}`}>
                      <SelectValue placeholder="请选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">public / OSS 直连</SelectItem>
                      <SelectItem value="proxy">proxy / 平台代理</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  disabled={savingToolKey === tool.toolKey}
                  loading={savingToolKey === tool.toolKey}
                  loadingText="保存中..."
                  onClick={() => handleSaveToolMode(tool.toolKey)}
                >
                  保存
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>过期资源清理</CardTitle>
          <CardDescription>
            先预检查，再决定是否执行实际删除。这里直接调用现有管理员清理接口。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="w-full max-w-[180px] space-y-2">
              <Label htmlFor="cleanup-limit">本次处理上限</Label>
              <Input
                id="cleanup-limit"
                inputMode="numeric"
                value={cleanupLimit}
                onChange={(event) => setCleanupLimit(event.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={cleanupLoading !== null}
                onClick={() => runCleanup(true)}
              >
                {cleanupLoading === "dry-run" ? "检查中..." : "预检查"}
              </Button>
              <Button
                type="button"
                disabled={cleanupLoading !== null}
                onClick={() => runCleanup(false)}
              >
                {cleanupLoading === "execute" ? "清理中..." : "执行清理"}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border">
            <div className="border-b px-4 py-3 text-sm font-medium">
              即将过期或已过期候选
            </div>
            <div className="divide-y">
              {data.cleanupCandidates.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  当前没有待清理资源。
                </div>
              ) : (
                data.cleanupCandidates.map((item) => (
                  <div key={item.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getStatusVariant(item.status)}>
                        {item.status}
                      </Badge>
                      <Badge variant="outline">{item.retentionClass}</Badge>
                      <span className="font-medium">{item.bucket}</span>
                    </div>
                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                      {item.key}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      用途 {item.purpose} · 过期时间{" "}
                      {formatDateTime(item.expiresAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {cleanupResult ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium">
                最近一次结果：扫描 {cleanupResult.total} 条，处理{" "}
                {cleanupResult.deleted} 条
              </p>
              <div className="mt-3 space-y-2">
                {cleanupResult.items.slice(0, 10).map((item) => (
                  <div key={item.id} className="text-xs text-muted-foreground">
                    [{item.status}] {item.bucket}/{item.key}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>主动整组清理</CardTitle>
          <CardDescription>
            用于在请求结束、异步任务结束或人工排障时，按 `requestId` 或 `taskId`
            清理整组临时资源。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="scoped-request-id">requestId</Label>
              <Input
                id="scoped-request-id"
                value={scopedCleanupTarget.requestId}
                onChange={(event) =>
                  setScopedCleanupTarget((current) => ({
                    ...current,
                    requestId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scoped-task-id">taskId</Label>
              <Input
                id="scoped-task-id"
                value={scopedCleanupTarget.taskId}
                onChange={(event) =>
                  setScopedCleanupTarget((current) => ({
                    ...current,
                    taskId: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={scopedCleanupLoading !== null}
              onClick={() => runScopedCleanup(true)}
            >
              {scopedCleanupLoading === "dry-run" ? "检查中..." : "整组预检查"}
            </Button>
            <Button
              type="button"
              disabled={scopedCleanupLoading !== null}
              onClick={() => runScopedCleanup(false)}
            >
              {scopedCleanupLoading === "execute"
                ? "清理中..."
                : "执行整组清理"}
            </Button>
          </div>

          {scopedCleanupResult ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium">
                最近一次整组结果：扫描 {scopedCleanupResult.total} 条，处理{" "}
                {scopedCleanupResult.deleted} 条
              </p>
              <div className="mt-3 space-y-2">
                {scopedCleanupResult.items.slice(0, 10).map((item) => (
                  <div key={item.id} className="text-xs text-muted-foreground">
                    [{item.status}] {item.bucket}/{item.key}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近资源明细</CardTitle>
          <CardDescription>
            支持分页查看全部对象资源记录，并可直接预览或下载。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
            <p className="text-muted-foreground">
              共 {data.recentPagination.total} 条，当前第{" "}
              {data.recentPagination.page} / {data.recentPagination.totalPages}{" "}
              页
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={data.recentPagination.page <= 1}
                onClick={() => jumpRecentPage(data.recentPagination.page - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  data.recentPagination.page >= data.recentPagination.totalPages
                }
                onClick={() => jumpRecentPage(data.recentPagination.page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1260px] text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">对象</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">用途</th>
                  <th className="px-3 py-2 font-medium">工具</th>
                  <th className="px-3 py-2 font-medium">来源</th>
                  <th className="px-3 py-2 font-medium">所有者</th>
                  <th className="px-3 py-2 font-medium">大小</th>
                  <th className="px-3 py-2 font-medium">访问</th>
                  <th className="px-3 py-2 font-medium">过期</th>
                  <th className="px-3 py-2 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recentObjects.map((item) => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <p className="font-medium">{item.bucket}</p>
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          {item.key}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.contentType}
                        </p>
                        {(item.requestId || item.taskId) && (
                          <p className="text-xs text-muted-foreground">
                            {item.requestId ? `request ${item.requestId}` : ""}{" "}
                            {item.taskId ? `task ${item.taskId}` : ""}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-2">
                        <Badge variant={getStatusVariant(item.status)}>
                          {item.status}
                        </Badge>
                        {item.deletedAt ? (
                          <p className="text-xs text-muted-foreground">
                            删于 {formatDateTime(item.deletedAt)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-2">
                        <Badge variant="outline">{item.retentionClass}</Badge>
                        <p>{item.purpose}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3">{item.toolKey || "-"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {resolveSourceInfo(item.metadata)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <p>{item.ownerName || "-"}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.ownerEmail || item.ownerUserId || "-"}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3">{formatBytes(item.size ?? 0)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.links.previewable ? (
                          <button
                            type="button"
                            className="text-xs text-blue-600 underline"
                            onClick={() => openPreview(item)}
                          >
                            预览
                          </button>
                        ) : null}
                        <a
                          className="text-xs text-blue-600 underline"
                          href={item.links.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          下载
                        </a>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {formatDateTime(item.expiresAt)}
                    </td>
                    <td className="px-3 py-3">
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            {data.recentObjects.map((item) => (
              <details
                key={`${item.id}-meta`}
                className="rounded-xl border px-4 py-3"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  元数据明细 · {item.bucket}/{item.key}
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(item.metadata ?? {}, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={previewingObject !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewingObject(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>资源预览</DialogTitle>
            <DialogDescription className="break-all">
              {previewingObject
                ? `${previewingObject.bucket}/${previewingObject.key}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2">
            {previewingObject ? (
              <StorageObjectPreview item={previewingObject} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 根据资源类型渲染预览内容。
 */
function StorageObjectPreview({ item }: { item: RecentStorageObject }) {
  const contentType = item.contentType.toLowerCase();

  // 图片和视频直接在弹窗内展示，避免跳到新页面。
  if (contentType.startsWith("image/")) {
    return (
      <div className="flex max-h-[72vh] items-center justify-center overflow-auto rounded-lg bg-slate-950/95 p-4">
        <Image
          src={item.links.previewUrl}
          alt={item.key}
          width={1600}
          height={1200}
          className="max-h-[68vh] w-auto max-w-full rounded-lg object-contain"
          unoptimized
        />
      </div>
    );
  }

  if (contentType.startsWith("video/")) {
    return (
      <div className="rounded-lg bg-slate-950/95 p-4">
        <video
          controls
          preload="metadata"
          className="max-h-[72vh] w-full rounded-lg"
          src={item.links.previewUrl}
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (contentType.startsWith("audio/")) {
    return (
      <div className="rounded-lg bg-slate-950/95 p-6">
        <audio
          controls
          preload="metadata"
          className="w-full"
          src={item.links.previewUrl}
        >
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  if (contentType === "application/pdf") {
    return (
      <iframe
        title={item.key}
        src={item.links.previewUrl}
        className="h-[72vh] w-full rounded-lg border"
      />
    );
  }

  if (contentType.startsWith("text/") || contentType.includes("json")) {
    return (
      <iframe
        title={item.key}
        src={item.links.previewUrl}
        className="h-[72vh] w-full rounded-lg border bg-white"
      />
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-6">
      <p className="text-sm text-muted-foreground">
        当前类型暂不支持内嵌预览，请直接下载查看。
      </p>
      <a
        className="text-sm text-blue-600 underline"
        href={item.links.downloadUrl}
        target="_blank"
        rel="noreferrer"
      >
        下载资源
      </a>
    </div>
  );
}

function SummaryCard(params: {
  title: string;
  value: string;
  description: string;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{params.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={
            params.danger
              ? "text-2xl font-bold text-red-600"
              : "text-2xl font-bold"
          }
        >
          {params.value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {params.description}
        </p>
      </CardContent>
    </Card>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

function getModeLabel(mode: StorageAssetUrlMode) {
  if (mode === "proxy") return "proxy / 平台代理";
  if (mode === "signed") return "signed / 临时签名";
  return "public / OSS 直连";
}

function getStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready") return "default";
  if (status === "deleted") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

function formatDateTime(value: Date | string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (!value) {
    return "0 B";
  }

  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function resolveSourceInfo(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return "-";
  }

  const source = metadata.source;
  if (typeof source === "string" && source.trim()) {
    return source.trim();
  }
  const uploadSource = metadata.uploadSource;
  if (typeof uploadSource === "string" && uploadSource.trim()) {
    return uploadSource.trim();
  }
  return "-";
}
