"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { commissionBalance } from "@/db/schema";
import {
  createWithdrawalRequest,
  markWithdrawalRequestPaid,
  rejectWithdrawalRequest,
} from "@/features/distribution/withdrawal";
import { getDefaultDistributionCurrency } from "@/features/distribution/presentation";
import {
  createDistributionWithdrawalSchema,
  reviewDistributionWithdrawalSchema,
} from "@/features/distribution/schema";
import { adminAction, protectedAction } from "@/lib/safe-action";

const withDistributionAction = (name: string) =>
  protectedAction.metadata({ action: `distribution.${name}` });

const withDistributionAdminAction = (name: string) =>
  adminAction.metadata({ action: `distribution.admin.${name}` });

/**
 * 创建用户提现申请
 */
export const createDistributionWithdrawalAction = withDistributionAction("createWithdrawal")
  .schema(createDistributionWithdrawalSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const [balance] = await db
      .select({ currency: commissionBalance.currency })
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, ctx.userId))
      .limit(1);

    const requestId = await createWithdrawalRequest({
      userId: ctx.userId,
      amount: data.amount,
      feeAmount: data.feeAmount,
      currency: balance?.currency ?? getDefaultDistributionCurrency(),
      payeeSnapshot: {
        channel: data.channel,
        accountName: data.accountName,
        accountNo: data.accountNo,
        note: data.note ?? "",
      },
    });

    revalidatePath("/dashboard/distribution");
    revalidatePath("/admin/distribution");

    return {
      message: "提现申请已提交",
      requestId,
    };
  });

/**
 * 管理端处理提现申请
 */
export const reviewDistributionWithdrawalAction = withDistributionAdminAction("reviewWithdrawal")
  .schema(reviewDistributionWithdrawalSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    if (data.decision === "reject") {
      await rejectWithdrawalRequest({
        requestId: data.requestId,
        operatorUserId: ctx.userId,
        ...(data.note ? { operatorNote: data.note } : {}),
      });
    } else {
      await markWithdrawalRequestPaid({
        requestId: data.requestId,
        operatorUserId: ctx.userId,
        ...(data.note ? { operatorNote: data.note } : {}),
      });
    }

    revalidatePath("/dashboard/distribution");
    revalidatePath("/admin/distribution");

    return {
      message: data.decision === "reject" ? "提现申请已驳回" : "提现申请已标记打款",
    };
  });
