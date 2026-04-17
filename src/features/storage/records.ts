import {
  and,
  count,
  desc,
  eq,
  isNull,
  lt,
  ne,
  or,
  sql,
  sum,
} from "drizzle-orm";

import { db } from "@/db";
import {
  type StorageRetentionClass,
  storageObject,
  toolRegistry,
  toolStorageRule,
  user,
} from "@/db/schema";
import {
  DEFAULT_PROJECT_KEY,
  getResolvedToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config/service";

type SaveStorageObjectParams = {
  bucket: string;
  key: string;
  contentType: string;
  ownerUserId?: string | null;
  toolKey?: string | null;
  purpose: string;
  retentionClass: StorageRetentionClass;
  expiresAt?: Date | null;
  size?: number | null;
  requestId?: string | null;
  taskId?: string | null;
  status: "pending" | "ready";
  metadata?: Record<string, unknown> | null;
};

type CleanupExpiredStorageObjectsParams = {
  limit?: number;
  dryRun?: boolean;
};

type CleanupScopedStorageObjectsParams = {
  requestId?: string;
  taskId?: string;
  dryRun?: boolean;
};

type StorageAssetUrlMode = "public" | "proxy" | "signed";

type StoragePrefixRule = {
  prefix: string;
  retentionClass: StorageRetentionClass;
  ttlHours?: number;
  purpose?: string;
  enabled?: boolean;
};

type StoragePolicyConfig = {
  ephemeralHours: number;
  temporaryDays: number;
  longTermDays: number;
  prefixRules: StoragePrefixRule[];
};

/**
 * 计算资源过期时间。
 */
export function getStorageExpiryDate(
  retentionClass: StorageRetentionClass,
  explicitExpiresAt?: Date | null
) {
  if (explicitExpiresAt) {
    return explicitExpiresAt;
  }

  const now = Date.now();
  if (retentionClass === "ephemeral") {
    return new Date(
      now +
        (Number(process.env.STORAGE_EPHEMERAL_HOURS ?? "6") || 6) *
          60 *
          60 *
          1000
    );
  }
  if (retentionClass === "temporary") {
    return new Date(
      now +
        (Number(process.env.STORAGE_TEMPORARY_DAYS ?? "3") || 3) *
          24 *
          60 *
          60 *
          1000
    );
  }
  if (retentionClass === "long_term") {
    return new Date(
      now +
        (Number(process.env.STORAGE_LONG_TERM_DAYS ?? "90") || 90) *
          24 *
          60 *
          60 *
          1000
    );
  }
  return null;
}

/**
 * 读取后台维护的对象存储策略。
 */
export async function getStoragePolicyConfig(): Promise<StoragePolicyConfig> {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: DEFAULT_PROJECT_KEY,
  });
  const resolved = await getResolvedToolConfig({
    projectKey: DEFAULT_PROJECT_KEY,
    toolKey: "storage",
  });
  const config = resolved.config as Record<string, unknown>;
  const ruleRows = await db
    .select()
    .from(toolStorageRule)
    .where(
      and(
        eq(toolStorageRule.projectId, currentProject.id),
        eq(toolStorageRule.enabled, true)
      )
    );

  return {
    ephemeralHours: normalizePositiveNumber(config.config1, 6),
    temporaryDays: normalizePositiveNumber(config.config2, 3),
    longTermDays: normalizePositiveNumber(config.config3, 90),
    prefixRules: mergeStoragePrefixRules(
      normalizePrefixRules(config.json1),
      normalizeToolStorageRules(ruleRows)
    ),
  };
}

/**
 * 按工具用途解析上传前缀。
 */
export async function resolveToolStoragePrefix(params: {
  toolKey: string;
  purpose: string;
  fallbackPrefix: string;
}) {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: DEFAULT_PROJECT_KEY,
  });
  const [rule] = await db
    .select({
      prefix: toolStorageRule.prefix,
    })
    .from(toolStorageRule)
    .where(
      and(
        eq(toolStorageRule.projectId, currentProject.id),
        eq(toolStorageRule.toolKey, params.toolKey),
        eq(toolStorageRule.purpose, params.purpose),
        eq(toolStorageRule.enabled, true)
      )
    )
    .limit(1);

  return rule?.prefix ?? params.fallbackPrefix;
}

/**
 * 写入或更新对象存储资源记录。
 */
export async function saveStorageObjectRecord(params: SaveStorageObjectParams) {
  const storagePolicy = await getStoragePolicyConfig();
  const matchedRule = findStoragePrefixRule(
    storagePolicy.prefixRules,
    params.key
  );
  const [existing] = await db
    .select()
    .from(storageObject)
    .where(
      and(
        eq(storageObject.bucket, params.bucket),
        eq(storageObject.key, params.key)
      )
    )
    .limit(1);

  const expiresAt = resolveStorageExpiryDate(
    params.retentionClass,
    storagePolicy,
    params.expiresAt ?? null,
    matchedRule
  );
  const purpose = params.purpose || matchedRule?.purpose || "generic_asset";

  if (existing) {
    const [updated] = await db
      .update(storageObject)
      .set({
        contentType: params.contentType,
        size: params.size ?? existing.size ?? null,
        ownerUserId: params.ownerUserId ?? existing.ownerUserId ?? null,
        toolKey: params.toolKey ?? existing.toolKey ?? null,
        purpose,
        retentionClass: params.retentionClass,
        expiresAt,
        requestId: params.requestId ?? existing.requestId ?? null,
        taskId: params.taskId ?? existing.taskId ?? null,
        status: params.status,
        metadata:
          params.metadata ??
          mergeStorageMetadata(existing.metadata, matchedRule?.prefix ?? null),
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(storageObject.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error("更新对象存储资源记录失败");
    }
    return updated;
  }

  const [created] = await db
    .insert(storageObject)
    .values({
      id: crypto.randomUUID(),
      bucket: params.bucket,
      key: params.key,
      contentType: params.contentType,
      size: params.size ?? null,
      ownerUserId: params.ownerUserId ?? null,
      toolKey: params.toolKey ?? null,
      purpose,
      retentionClass: params.retentionClass,
      expiresAt,
      requestId: params.requestId ?? null,
      taskId: params.taskId ?? null,
      status: params.status,
      metadata: mergeStorageMetadata(
        params.metadata,
        matchedRule?.prefix ?? null
      ),
    })
    .returning();

  if (!created) {
    throw new Error("创建对象存储资源记录失败");
  }
  return created;
}

/**
 * 清理过期的对象存储资源。
 */
export async function cleanupExpiredStorageObjects(
  params: CleanupExpiredStorageObjectsParams = {}
) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const expiredObjects = await db
    .select()
    .from(storageObject)
    .where(
      and(
        isNull(storageObject.deletedAt),
        ne(storageObject.status, "deleted"),
        lt(storageObject.expiresAt, new Date())
      )
    )
    .orderBy(storageObject.expiresAt)
    .limit(limit);

  if (params.dryRun) {
    return {
      total: expiredObjects.length,
      deleted: 0,
      items: expiredObjects.map((item) => ({
        id: item.id,
        bucket: item.bucket,
        key: item.key,
        purpose: item.purpose,
        retentionClass: item.retentionClass,
        status: "pending_cleanup",
      })),
    };
  }

  return performStorageDeletion(expiredObjects);
}

/**
 * 按 requestId 或 taskId 主动清理一组资源。
 */
export async function cleanupScopedStorageObjects(
  params: CleanupScopedStorageObjectsParams
) {
  if (!params.requestId && !params.taskId) {
    throw new Error("requestId 或 taskId 至少需要提供一个");
  }

  const conditions = [
    isNull(storageObject.deletedAt),
    ne(storageObject.status, "deleted"),
  ];
  if (params.requestId) {
    conditions.push(eq(storageObject.requestId, params.requestId));
  }
  if (params.taskId) {
    conditions.push(eq(storageObject.taskId, params.taskId));
  }

  const scopedObjects = await db
    .select()
    .from(storageObject)
    .where(and(...conditions))
    .orderBy(storageObject.createdAt);

  if (params.dryRun) {
    return {
      total: scopedObjects.length,
      deleted: 0,
      items: scopedObjects.map((item) => ({
        id: item.id,
        bucket: item.bucket,
        key: item.key,
        purpose: item.purpose,
        retentionClass: item.retentionClass,
        status: "pending_cleanup",
      })),
    };
  }

  return performStorageDeletion(scopedObjects);
}

/**
 * 读取管理员存储页面数据。
 */
export async function getStorageAdminPageData() {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: DEFAULT_PROJECT_KEY,
  });
  const now = new Date();
  const storagePolicy = await getStoragePolicyConfig();

  // 读取当前对象存储运行配置，便于后台核对实际环境。
  const storageConfig = {
    provider: process.env.STORAGE_PROVIDER ?? "s3_compatible",
    vendor: process.env.STORAGE_VENDOR ?? "generic",
    endpoint: process.env.STORAGE_ENDPOINT ?? "",
    bucket: process.env.STORAGE_BUCKET_NAME ?? "",
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    aiProxyBaseUrl:
      process.env.STORAGE_AI_PROXY_BASE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "",
    defaultAiUrlMode: normalizeStorageAssetUrlMode(
      process.env.STORAGE_AI_URL_MODE ?? "public"
    ),
    uploadExpiresSeconds: Number(
      process.env.STORAGE_UPLOAD_URL_EXPIRES ?? "300"
    ),
    ephemeralHours: storagePolicy.ephemeralHours,
    temporaryDays: storagePolicy.temporaryDays,
    longTermDays: storagePolicy.longTermDays,
    prefixRules: storagePolicy.prefixRules,
  };

  const enabledTools = await db
    .select({
      toolKey: toolRegistry.toolKey,
      name: toolRegistry.name,
      description: toolRegistry.description,
    })
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        eq(toolRegistry.enabled, true)
      )
    )
    .orderBy(toolRegistry.sortOrder, toolRegistry.toolKey);

  const toolModes = await Promise.all(
    enabledTools
      .filter((tool) => tool.toolKey !== "storage")
      .map(async (tool) => {
        const resolved = await getResolvedToolConfig({
          projectKey: currentProject.key,
          toolKey: tool.toolKey,
        });
        const config = resolved.config as Record<string, unknown>;

        return {
          toolKey: tool.toolKey,
          name: tool.name,
          description: tool.description,
          assetUrlMode: normalizeStorageAssetUrlMode(config.config10),
        };
      })
  );

  const [summaryRow] = await db
    .select({
      totalObjects: count(storageObject.id),
      readyObjects: sql<number>`count(*) filter (where ${storageObject.status} = 'ready')`,
      pendingObjects: sql<number>`count(*) filter (where ${storageObject.status} = 'pending')`,
      deletedObjects: sql<number>`count(*) filter (where ${storageObject.status} = 'deleted')`,
      expiredObjects: sql<number>`count(*) filter (where ${storageObject.expiresAt} is not null and ${storageObject.expiresAt} < ${now} and ${storageObject.status} <> 'deleted')`,
      totalSizeBytes: sum(storageObject.size),
    })
    .from(storageObject);

  const [retentionRow] = await db
    .select({
      permanentCount: sql<number>`count(*) filter (where ${storageObject.retentionClass} = 'permanent')`,
      longTermCount: sql<number>`count(*) filter (where ${storageObject.retentionClass} = 'long_term')`,
      temporaryCount: sql<number>`count(*) filter (where ${storageObject.retentionClass} = 'temporary')`,
      ephemeralCount: sql<number>`count(*) filter (where ${storageObject.retentionClass} = 'ephemeral')`,
    })
    .from(storageObject);

  const recentObjects = await db
    .select({
      id: storageObject.id,
      bucket: storageObject.bucket,
      key: storageObject.key,
      contentType: storageObject.contentType,
      size: storageObject.size,
      ownerUserId: storageObject.ownerUserId,
      ownerName: user.name,
      ownerEmail: user.email,
      toolKey: storageObject.toolKey,
      purpose: storageObject.purpose,
      retentionClass: storageObject.retentionClass,
      expiresAt: storageObject.expiresAt,
      requestId: storageObject.requestId,
      taskId: storageObject.taskId,
      status: storageObject.status,
      metadata: storageObject.metadata,
      deletedAt: storageObject.deletedAt,
      createdAt: storageObject.createdAt,
      updatedAt: storageObject.updatedAt,
    })
    .from(storageObject)
    .leftJoin(user, eq(user.id, storageObject.ownerUserId))
    .orderBy(desc(storageObject.createdAt))
    .limit(50);

  const cleanupCandidates = await db
    .select({
      id: storageObject.id,
      bucket: storageObject.bucket,
      key: storageObject.key,
      purpose: storageObject.purpose,
      retentionClass: storageObject.retentionClass,
      expiresAt: storageObject.expiresAt,
      status: storageObject.status,
    })
    .from(storageObject)
    .where(
      and(
        isNull(storageObject.deletedAt),
        or(
          eq(storageObject.status, "pending"),
          eq(storageObject.status, "ready")
        ),
        lt(storageObject.expiresAt, now)
      )
    )
    .orderBy(storageObject.expiresAt)
    .limit(20);

  return {
    project: {
      key: currentProject.key,
      name: currentProject.name,
      revision: currentProject.configRevision,
    },
    config: storageConfig,
    toolModes,
    summary: {
      totalObjects: Number(summaryRow?.totalObjects ?? 0),
      readyObjects: Number(summaryRow?.readyObjects ?? 0),
      pendingObjects: Number(summaryRow?.pendingObjects ?? 0),
      deletedObjects: Number(summaryRow?.deletedObjects ?? 0),
      expiredObjects: Number(summaryRow?.expiredObjects ?? 0),
      totalSizeBytes: Number(summaryRow?.totalSizeBytes ?? 0),
      permanentCount: Number(retentionRow?.permanentCount ?? 0),
      longTermCount: Number(retentionRow?.longTermCount ?? 0),
      temporaryCount: Number(retentionRow?.temporaryCount ?? 0),
      ephemeralCount: Number(retentionRow?.ephemeralCount ?? 0),
    },
    cleanupCandidates,
    recentObjects,
  };
}

/**
 * 归一化存储资源访问方式。
 */
function normalizeStorageAssetUrlMode(value: unknown): StorageAssetUrlMode {
  return value === "proxy" || value === "signed" ? value : "public";
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizePrefixRules(value: unknown): StoragePrefixRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => ({
      prefix: String(item.prefix ?? "").trim(),
      retentionClass: normalizeRetentionClass(item.retentionClass),
      ...(item.ttlHours === undefined
        ? {}
        : { ttlHours: normalizePositiveNumber(item.ttlHours, 24) }),
      ...(typeof item.purpose === "string" && item.purpose.trim()
        ? { purpose: item.purpose.trim() }
        : {}),
      enabled: item.enabled !== false,
    }))
    .filter((item) => item.prefix.length > 0);
}

function normalizeToolStorageRules(
  rows: Array<typeof toolStorageRule.$inferSelect>
): StoragePrefixRule[] {
  return rows.map((item) => ({
    prefix: item.prefix,
    retentionClass: item.retentionClass,
    ...(item.ttlHours ? { ttlHours: item.ttlHours } : {}),
    purpose: item.purpose,
    enabled: item.enabled,
  }));
}

function mergeStoragePrefixRules(
  configRules: StoragePrefixRule[],
  toolRules: StoragePrefixRule[]
) {
  const mergedByPrefix = new Map<string, StoragePrefixRule>();
  for (const rule of configRules) {
    mergedByPrefix.set(rule.prefix, rule);
  }
  for (const rule of toolRules) {
    mergedByPrefix.set(rule.prefix, rule);
  }
  return [...mergedByPrefix.values()];
}

function normalizeRetentionClass(value: unknown): StorageRetentionClass {
  return value === "permanent" || value === "temporary" || value === "ephemeral"
    ? value
    : "long_term";
}

function findStoragePrefixRule(rules: StoragePrefixRule[], key: string) {
  return [...rules]
    .filter((item) => item.enabled !== false && key.startsWith(item.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

function resolveStorageExpiryDate(
  retentionClass: StorageRetentionClass,
  storagePolicy: StoragePolicyConfig,
  explicitExpiresAt?: Date | null,
  matchedRule?: StoragePrefixRule
) {
  if (explicitExpiresAt) {
    return explicitExpiresAt;
  }
  if (matchedRule?.ttlHours && retentionClass !== "permanent") {
    return new Date(Date.now() + matchedRule.ttlHours * 60 * 60 * 1000);
  }
  if (retentionClass === "ephemeral") {
    return new Date(Date.now() + storagePolicy.ephemeralHours * 60 * 60 * 1000);
  }
  if (retentionClass === "temporary") {
    return new Date(
      Date.now() + storagePolicy.temporaryDays * 24 * 60 * 60 * 1000
    );
  }
  if (retentionClass === "long_term") {
    return new Date(
      Date.now() + storagePolicy.longTermDays * 24 * 60 * 60 * 1000
    );
  }
  return null;
}

function mergeStorageMetadata(
  metadata: Record<string, unknown> | null | undefined,
  matchedPrefix: string | null
) {
  return {
    ...(metadata ?? {}),
    ...(matchedPrefix ? { matchedPrefixRule: matchedPrefix } : {}),
  };
}

async function performStorageDeletion(
  objects: Array<typeof storageObject.$inferSelect>
) {
  const { getStorageProvider } = await import("./providers");
  const provider = getStorageProvider();
  const items: Array<{
    id: string;
    bucket: string;
    key: string;
    purpose: string;
    retentionClass: StorageRetentionClass;
    status: "deleted" | "failed";
  }> = [];

  for (const item of objects) {
    try {
      await provider.deleteObject(item.key, item.bucket);
      await db
        .update(storageObject)
        .set({
          status: "deleted",
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(storageObject.id, item.id));
      items.push({
        id: item.id,
        bucket: item.bucket,
        key: item.key,
        purpose: item.purpose,
        retentionClass: item.retentionClass,
        status: "deleted",
      });
    } catch {
      items.push({
        id: item.id,
        bucket: item.bucket,
        key: item.key,
        purpose: item.purpose,
        retentionClass: item.retentionClass,
        status: "failed",
      });
    }
  }

  return {
    total: objects.length,
    deleted: items.filter((item) => item.status === "deleted").length,
    items,
  };
}
