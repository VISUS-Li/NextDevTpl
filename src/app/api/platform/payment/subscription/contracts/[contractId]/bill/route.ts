import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptionContract } from "@/db/schema";
import { triggerSubscriptionBilling } from "@/features/payment/subscription-recurring";
import { auth } from "@/lib/auth";

/**
 * 触发连续扣费账单生成。
 *
 * 当前阶段允许签约用户本人或管理员手工触发，用于首期联调和定时任务接入前过渡。
 */
export async function POST(
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
  const [contract] = await db
    .select({ userId: subscriptionContract.userId })
    .from(subscriptionContract)
    .where(eq(subscriptionContract.id, contractId))
    .limit(1);

  if (!contract) {
    return NextResponse.json(
      { success: false, error: "签约不存在" },
      { status: 404 }
    );
  }

  const role = (session.user as { role?: string }).role;
  if (contract.userId !== session.user.id && role !== "admin") {
    return NextResponse.json(
      { success: false, error: "需要管理员权限" },
      { status: 403 }
    );
  }

  const billing = await triggerSubscriptionBilling({ contractId });
  return NextResponse.json({ success: true, billing }, { status: 201 });
}
