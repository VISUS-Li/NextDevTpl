import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestBaseUrl } from "@/config/payment";
import {
  createSubscriptionContractIntent,
  listUserSubscriptionContracts,
} from "@/features/payment/subscription-recurring";
import { PlanInterval } from "@/features/payment/types";
import { auth } from "@/lib/auth";

const createContractSchema = z.object({
  provider: z.enum(["wechat_pay", "alipay"]),
  planId: z.enum(["starter", "pro", "ultra"]),
  interval: z.nativeEnum(PlanInterval),
});

/**
 * 创建连续扣费签约。
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }

  const payload = createContractSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: "参数错误", details: payload.error.flatten() },
      { status: 400 }
    );
  }

  const result = await createSubscriptionContractIntent({
    userId: session.user.id,
    baseUrl: await getRequestBaseUrl(),
    ...payload.data,
  });

  return NextResponse.json({ success: true, ...result });
}

/**
 * 列出当前用户的连续扣费签约。
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }

  const contracts = await listUserSubscriptionContracts(session.user.id);
  return NextResponse.json({ success: true, contracts });
}
