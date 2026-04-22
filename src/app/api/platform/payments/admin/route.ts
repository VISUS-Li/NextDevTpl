import { NextResponse } from "next/server";
import { z } from "zod";

import { listAdminPayments } from "@/features/payment/admin";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  query: z.string().trim().optional(),
  provider: z.enum(["all", "creem", "wechat_pay", "alipay"]).optional(),
  orderType: z.enum(["all", "subscription", "credit_purchase"]).optional(),
  paymentState: z
    .enum(["all", "paid", "confirmed", "closed", "partial_refund", "refunded"])
    .optional(),
});

/**
 * 管理员支付列表接口。
 */
export const GET = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "unauthorized", message: "未登录" },
      { status: 401 }
    );
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json(
      { success: false, error: "forbidden", message: "需要管理员权限" },
      { status: 403 }
    );
  }

  const requestUrl = new URL(request.url);
  const payload = querySchema.safeParse({
    page: requestUrl.searchParams.get("page") ?? undefined,
    pageSize: requestUrl.searchParams.get("pageSize") ?? undefined,
    query: requestUrl.searchParams.get("query") ?? undefined,
    provider: requestUrl.searchParams.get("provider") ?? undefined,
    orderType: requestUrl.searchParams.get("orderType") ?? undefined,
    paymentState: requestUrl.searchParams.get("paymentState") ?? undefined,
  });

  if (!payload.success) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_request",
        message: "参数错误",
        details: payload.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await listAdminPayments({
    ...(payload.data.page !== undefined ? { page: payload.data.page } : {}),
    ...(payload.data.pageSize !== undefined
      ? { pageSize: payload.data.pageSize }
      : {}),
    ...(payload.data.query !== undefined ? { query: payload.data.query } : {}),
    ...(payload.data.provider !== undefined
      ? { provider: payload.data.provider }
      : {}),
    ...(payload.data.orderType !== undefined
      ? { orderType: payload.data.orderType }
      : {}),
    ...(payload.data.paymentState !== undefined
      ? { paymentState: payload.data.paymentState }
      : {}),
  });
  return NextResponse.json({ success: true, ...result });
});
