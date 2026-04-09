import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";
import { getStorageProvider } from "@/features/storage/providers";
import { saveStorageObjectRecord } from "@/features/storage";

const saveResultSchema = z.object({
  tool: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(80),
  payload: z.record(z.string(), z.unknown()),
});

/**
 * 保存工具结果
 *
 * 当前先写入对象存储，作为平台侧最小结果归档。
 */
export const POST = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "未登录",
      },
      { status: 401 }
    );
  }

  const payload = saveResultSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
        details: payload.error.flatten(),
      },
      { status: 400 }
    );
  }

  const bucket = process.env.STORAGE_BUCKET_NAME || "nextdevtpl-uploads";
  const key = `redink/results/${session.user.id}/${payload.data.type}_${nanoid()}.json`;
  const provider = getStorageProvider();
  const body = JSON.stringify(
    {
      userId: session.user.id,
      tool: payload.data.tool,
      type: payload.data.type,
      savedAt: new Date().toISOString(),
      payload: payload.data.payload,
    },
    null,
    2
  );

  await provider.putObject(key, bucket, body, "application/json; charset=utf-8");
  const storageRecord = await saveStorageObjectRecord({
    bucket,
    key,
    contentType: "application/json; charset=utf-8",
    ownerUserId: session.user.id,
    toolKey: payload.data.tool,
    purpose: "result_archive",
    retentionClass: "long_term",
    status: "ready",
  });

  return NextResponse.json({
    success: true,
    key,
    bucket,
    retentionClass: storageRecord.retentionClass,
    expiresAt: storageRecord.expiresAt,
  });
});
