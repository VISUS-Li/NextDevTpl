import { NextResponse } from "next/server";

import { getStorageProvider } from "@/features/storage/providers";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 读取单条平台结果详情
 */
export const GET = withApiLogging(async (request: Request) => {
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

  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
      },
      { status: 400 }
    );
  }

  const expectedPrefix = `redink/results/${session.user.id}/`;
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json(
      {
        success: false,
        error: "无权访问该结果",
      },
      { status: 403 }
    );
  }

  const bucket = process.env.STORAGE_BUCKET_NAME || "nextdevtpl-uploads";
  const provider = getStorageProvider();
  const content = await provider.getObject(key, bucket);
  const result = JSON.parse(content.toString("utf-8"));

  return NextResponse.json({
    success: true,
    key,
    bucket,
    result,
  });
});
