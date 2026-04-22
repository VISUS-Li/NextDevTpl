import { NextResponse } from "next/server";

import { getAdminPaymentDetail } from "@/features/payment/admin";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 管理员支付详情接口。
 */
export const GET = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ orderId: string }> }
  ) => {
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

    const { orderId } = await context.params;
    const detail = await getAdminPaymentDetail(orderId);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: "not_found", message: "支付单不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, detail });
  }
);
