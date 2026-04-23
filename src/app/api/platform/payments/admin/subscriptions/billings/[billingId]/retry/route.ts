import { NextResponse } from "next/server";

import { retrySubscriptionBilling } from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 管理员手工补扣失败账单。
 */
export const POST = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ billingId: string }> }
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

    const { billingId } = await context.params;
    const billing = await retrySubscriptionBilling(billingId);
    return NextResponse.json({ success: true, billing });
  }
);
