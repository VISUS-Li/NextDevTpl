import { NextResponse } from "next/server";

import { getRedinkUserModelCatalog } from "@/features/redink/service";
import { toolConfigProjectKeySchema } from "@/features/tool-config/schema";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 返回 RedInk 用户可见模型目录。
 */
export const GET = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "unauthorized", message: "未登录" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const projectKey = toolConfigProjectKeySchema.safeParse(
    url.searchParams.get("projectKey") ?? "nextdevtpl"
  );

  if (!projectKey.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
        details: projectKey.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await getRedinkUserModelCatalog({
    projectKey: projectKey.data,
    userId: session.user.id,
  });
  const etag = `W/"redink-model-options-${projectKey.data}-${result.revision}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    });
  }

  return NextResponse.json(
    {
      success: true,
      ...result,
    },
    {
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    }
  );
});
