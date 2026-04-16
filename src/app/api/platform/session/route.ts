import { NextResponse } from "next/server";
import { CREDITS_EXPIRY_DAYS } from "@/features/credits/config";
import {
  ensureRegistrationBonus,
  getCreditsBalance,
  getRegistrationBonusCredits,
} from "@/features/credits/core";
import { getUserPlan } from "@/features/subscription/services/user-plan";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

/**
 * 获取平台会话信息
 *
 * 返回当前登录用户、套餐和积分余额。
 */
export const GET = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "未登录",
      },
      { status: 401 }
    );
  }

  // 新用户首次访问时补发注册积分，保持与站内逻辑一致。
  await ensureRegistrationBonus(
    session.user.id,
    await getRegistrationBonusCredits(),
    CREDITS_EXPIRY_DAYS
  );

  const [plan, balance] = await Promise.all([
    getUserPlan(session.user.id),
    getCreditsBalance(session.user.id),
  ]);

  return NextResponse.json({
    success: true,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
      role: (session.user as { role?: string }).role ?? "user",
    },
    plan: {
      code: plan.plan,
      name: plan.planName,
      hasActiveSubscription: plan.hasActiveSubscription,
      subscriptionStatus: plan.subscriptionStatus,
      currentPeriodEnd: plan.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
    },
    credits: {
      balance: balance.balance,
      totalEarned: balance.totalEarned,
      totalSpent: balance.totalSpent,
      status: balance.status,
    },
  });
});
