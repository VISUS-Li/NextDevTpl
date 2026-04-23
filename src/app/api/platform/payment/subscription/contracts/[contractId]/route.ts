import { NextResponse } from "next/server";

import {
  cancelUserSubscriptionContract,
  getUserSubscriptionContract,
} from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 读取当前用户自己的连续扣费签约。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ contractId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }

  const { contractId } = await context.params;
  const contract = await getUserSubscriptionContract(
    contractId,
    session.user.id
  );
  if (!contract) {
    return NextResponse.json(
      { success: false, error: "签约不存在" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, contract });
}

/**
 * 取消当前用户自己的连续扣费签约。
 */
export const DELETE = withApiLogging(
  async (
    request: Request,
    context: { params: Promise<{ contractId: string }> }
  ) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    const { contractId } = await context.params;
    const contract = await cancelUserSubscriptionContract({
      contractId,
      userId: session.user.id,
    });
    return NextResponse.json({ success: true, contract });
  }
);
