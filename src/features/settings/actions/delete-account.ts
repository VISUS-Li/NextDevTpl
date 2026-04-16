"use server";

import { eq } from "drizzle-orm";

import { db, user } from "@/db";
import { subscription } from "@/db/schema";
import { creem } from "@/features/payment/creem";
import { protectedAction } from "@/lib/safe-action";

/**
 * 删除当前用户账户。
 */
export const deleteAccountAction = protectedAction
  .metadata({ action: "settings.deleteAccount" })
  .action(async ({ ctx }) => {
    // 先停止仍处于有效状态的订阅，避免账户删除后继续扣费。
    const [activeSubscription] = await db
      .select({
        subscriptionId: subscription.subscriptionId,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      })
      .from(subscription)
      .where(eq(subscription.userId, ctx.userId))
      .limit(1);

    if (
      activeSubscription?.subscriptionId &&
      !activeSubscription.cancelAtPeriodEnd &&
      ["active", "trialing", "past_due", "paused"].includes(
        activeSubscription.status
      )
    ) {
      await creem.cancelSubscription(activeSubscription.subscriptionId);
    }

    const [deletedUser] = await db
      .delete(user)
      .where(eq(user.id, ctx.userId))
      .returning({ id: user.id });

    if (!deletedUser) {
      throw new Error("删除账户失败，请稍后重试");
    }

    return {
      success: true,
      message: "账户已删除",
    };
  });
