import { NextResponse } from "next/server";
import { z } from "zod";

import {
  cancelUserSubscriptionContract,
  getUserSubscriptionContract,
  scheduleSubscriptionContractPlanChange,
} from "@/features/payment/subscription-recurring";
import { PlanInterval } from "@/features/payment/types";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const updatePlanSchema = z.object({
  planId: z.enum(["starter", "pro", "ultra"]),
  interval: z.nativeEnum(PlanInterval),
});

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

/**
 * 调整下一个账期生效的订阅套餐。
 */
export const PATCH = withApiLogging(
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

    const payload = updatePlanSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { success: false, error: "参数错误" },
        { status: 400 }
      );
    }

    const { contractId } = await context.params;
    const contract = await scheduleSubscriptionContractPlanChange({
      contractId,
      userId: session.user.id,
      planId: payload.data.planId,
      interval: payload.data.interval,
    });
    return NextResponse.json({ success: true, contract });
  }
);
