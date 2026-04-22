import { NextResponse } from "next/server";

import { localProvider } from "@/features/storage/providers";
import { confirmStorageObjectUpload } from "@/features/storage/records";

// 接收本地存储上传请求并写入开发机磁盘。
export async function PUT(request: Request) {
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") || "";
  const key = url.searchParams.get("key") || "";
  const contentType =
    url.searchParams.get("contentType") || "application/octet-stream";
  const body = Buffer.from(await request.arrayBuffer());

  await localProvider.putObject(key, bucket, body, contentType);
  await confirmStorageObjectUpload({
    bucket,
    key,
    size: body.byteLength,
    contentType,
    metadata: {
      uploadSource: "local_upload_route",
    },
  });

  return NextResponse.json({ success: true });
}
