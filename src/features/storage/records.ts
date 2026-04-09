import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  storageObject,
  type StorageRetentionClass,
} from "@/db/schema";

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
 * 写入或更新对象存储资源记录。
 */
export async function saveStorageObjectRecord(params: SaveStorageObjectParams) {
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

  const expiresAt = getStorageExpiryDate(
    params.retentionClass,
    params.expiresAt ?? null
  );

  if (existing) {
    const [updated] = await db
      .update(storageObject)
      .set({
        contentType: params.contentType,
        size: params.size ?? existing.size ?? null,
        ownerUserId: params.ownerUserId ?? existing.ownerUserId ?? null,
        toolKey: params.toolKey ?? existing.toolKey ?? null,
        purpose: params.purpose,
        retentionClass: params.retentionClass,
        expiresAt,
        requestId: params.requestId ?? existing.requestId ?? null,
        taskId: params.taskId ?? existing.taskId ?? null,
        status: params.status,
        metadata: params.metadata ?? existing.metadata ?? null,
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
      purpose: params.purpose,
      retentionClass: params.retentionClass,
      expiresAt,
      requestId: params.requestId ?? null,
      taskId: params.taskId ?? null,
      status: params.status,
      metadata: params.metadata ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("创建对象存储资源记录失败");
  }
  return created;
}
