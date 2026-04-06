"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { commissionBalance } from "@/db/schema";
import {
  createWithdrawalRequest,
  markWithdrawalRequestPaid,
  rejectWithdrawalRequest,
} from "@/features/distribution/withdrawal";
import { getDefaultDistributionCurrency } from "@/features/distribution/presentation";
import { adminAction, protectedAction } from "@/lib/safe-action";

const withDistributionAction = (name: string) =>
  protectedAction.metadata({ action: `distribution.${name}` });

const withDistributionAdminAction = (name: string) =>
  adminAction.metadata({ action: `distribution.admin.${name}` });

/**
 * 提现申请表单校验
 */
export const createDistributionWithdrawalSchema = z.object({
  amount: z.number().int().min(1, "提现金额必须大于 0"),
  feeAmount: z.number().int().min(0, "手续费不能小于 0"),
  channel: z.string().trim().min(1, "请选择收款渠道").max(40, "渠道名称过长"),
  accountName: z.string().trim().min(1, "请输入收款人").max(80, "收款人名称过长"),
  accountNo: z.string().trim().min(1, "请输入收款账号").max(120, "收款账号过长"),
  note: z.string().trim().max(200, "备注最多 200 个字符").optional(),
});

/**
 * 管理端提现审核校验
 */
export const reviewDistributionWithdrawalSchema = z.object({
  requestId: z.string().min(1, "申请记录不能为空"),
  decision: z.enum(["reject", "paid"]),
  note: z.string().trim().max(200, "备注最多 200 个字符").optional(),
});

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
