import { NextResponse } from "next/server";

import { getStorageProvider } from "@/features/storage/providers";
import { auth } from "@/lib/auth";
import { withApiLogging } from "@/lib/api-logger";

type StoredResult = {
  userId: string;
  tool: string;
  type: string;
  savedAt: string;
  payload: Record<string, unknown>;
};

/**
 * 读取平台结果列表
 *
 * 当前只返回当前用户自己的结果，用于工具侧回看历史结果。
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
  const tool = url.searchParams.get("tool")?.trim() || "";
  const resultType = url.searchParams.get("type")?.trim() || "";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") || "20"), 1),
    50
  );
  const bucket = process.env.STORAGE_BUCKET_NAME || "nextdevtpl-uploads";
  const prefix = `redink/results/${session.user.id}/`;
  const provider = getStorageProvider();
  const objects = await provider.listObjects(prefix, bucket, limit);

  const items = await Promise.all(
    objects.map(async (item) => {
      const content = await provider.getObject(item.key, bucket);
      const parsed = JSON.parse(content.toString("utf-8")) as StoredResult;
      return {
        key: item.key,
        bucket,
        tool: parsed.tool,
        type: parsed.type,
        savedAt: parsed.savedAt,
        title:
          getProductName(parsed.payload) ||
          getFirstTitle(parsed.payload) ||
          "未命名结果",
        preview:
          getFirstTitle(parsed.payload) ||
          getCopywriting(parsed.payload).slice(0, 80),
      };
    })
  );

  const filtered = items
    .filter((item) => !tool || item.tool === tool)
    .filter((item) => !resultType || item.type === resultType)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, limit);

  return NextResponse.json({
    success: true,
    items: filtered,
  });
});

/**
 * 读取商品名称
 */
function getProductName(payload: Record<string, unknown>): string {
  const productInfo = payload.product_info;
  if (!productInfo || typeof productInfo !== "object") {
    return "";
  }

  const productName = (productInfo as { product_name?: unknown }).product_name;
  return typeof productName === "string" ? productName : "";
}

/**
 * 读取第一条标题
 */
function getFirstTitle(payload: Record<string, unknown>): string {
  const copyResult = payload.copy_result;
  if (!copyResult || typeof copyResult !== "object") {
    return "";
  }

  const titles = (copyResult as { titles?: unknown }).titles;
  return Array.isArray(titles) && typeof titles[0] === "string" ? titles[0] : "";
}

/**
 * 读取正文摘要
 */
function getCopywriting(payload: Record<string, unknown>): string {
  const copyResult = payload.copy_result;
  if (!copyResult || typeof copyResult !== "object") {
    return "";
  }

  const copywriting = (copyResult as { copywriting?: unknown }).copywriting;
  return typeof copywriting === "string" ? copywriting : "";
}
