import { NextResponse } from "next/server";

import { localProvider } from "@/features/storage/providers";

// 读取本地存储文件并返回给调用方。
export async function GET(request: Request) {
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") || "";
  const key = url.searchParams.get("key") || "";
  const content = await localProvider.getObject(key, bucket);

  return new NextResponse(new Uint8Array(content));
}
