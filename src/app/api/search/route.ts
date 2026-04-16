import { NextResponse } from "next/server";

import { withApiLogging } from "@/lib/api-logger";

/**
 * 搜索接口已随开发文档下架。
 */
export const GET = withApiLogging(async () =>
  NextResponse.json({ error: "not_found" }, { status: 404 })
);
