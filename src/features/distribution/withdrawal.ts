import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  commissionBalance,
  commissionLedger,
  withdrawalRequest,
} from "@/db/schema";

/**
 * 创建提现申请
 */
export async function createWithdrawalRequest(params: {
  userId: string;
  amount: number;
  currency: string;
  feeAmount?: number;
  payeeSnapshot?: Record<string, unknown>;
}) {
  // 提现申请只接受正数金额，且币种必须和账户一致。
  if (params.amount <= 0) {
    throw new Error("Withdrawal amount must be greater than 0");
  }
  return await db.transaction(async (tx) => {
    const [balance] = await tx
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, params.userId))
      .limit(1);

    const feeAmount = params.feeAmount ?? 0;
    if (feeAmount < 0 || feeAmount > params.amount) {
      throw new Error("Withdrawal fee amount is invalid");
    }
    if (!balance) {
      throw new Error("Commission balance not found");
    }
    if (balance.currency !== params.currency) {
      throw new Error("Withdrawal currency does not match commission balance");
    }

    const freezeAmount = params.amount + feeAmount;
    if (balance.availableAmount < freezeAmount) {
      throw new Error("Insufficient available commission balance");
    }

    const requestId = crypto.randomUUID();
    const nextAvailableAmount = balance.availableAmount - freezeAmount;
    const nextFrozenAmount = balance.frozenAmount + freezeAmount;

    // 提现申请、余额冻结和账本必须同步提交，避免出现半成状态。
    await tx.insert(withdrawalRequest).values({
      id: requestId,
      userId: params.userId,
      amount: params.amount,
      feeAmount,
      netAmount: params.amount - feeAmount,
      currency: params.currency,
      status: "pending",
      payeeSnapshot: params.payeeSnapshot,
    });

    await tx
      .update(commissionBalance)
      .set({
        availableAmount: nextAvailableAmount,
        frozenAmount: nextFrozenAmount,
        updatedAt: new Date(),
      })
      .where(eq(commissionBalance.id, balance.id));

    await tx.insert(commissionLedger).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      entryType: "withdraw_freeze",
      direction: "debit",
      amount: freezeAmount,
      beforeBalance: balance.availableAmount,
      afterBalance: nextAvailableAmount,
      referenceType: "withdrawal_request",
      referenceId: requestId,
      memo: "withdrawal requested",
    });

    return requestId;
  });
}

/**
 * 拒绝提现申请
 */
export async function rejectWithdrawalRequest(params: {
  requestId: string;
  operatorUserId: string;
  operatorNote?: string;
}) {
  return await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, params.requestId))
      .limit(1);

    if (!request || request.status !== "pending") {
      throw new Error("Withdrawal request is not pending");
    }

    const [balance] = await tx
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, request.userId))
      .limit(1);

    if (!balance) {
      throw new Error("Commission balance not found");
    }

    const freezeAmount = request.amount + request.feeAmount;
    const nextAvailableAmount = balance.availableAmount + freezeAmount;
    const nextFrozenAmount = Math.max(0, balance.frozenAmount - freezeAmount);

    await tx
      .update(withdrawalRequest)
      .set({
        status: "rejected",
        operatorUserId: params.operatorUserId,
        operatorNote: params.operatorNote ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequest.id, params.requestId));

    await tx
      .update(commissionBalance)
      .set({
        availableAmount: nextAvailableAmount,
        frozenAmount: nextFrozenAmount,
        updatedAt: new Date(),
      })
      .where(eq(commissionBalance.id, balance.id));

    await tx.insert(commissionLedger).values({
      id: crypto.randomUUID(),
      userId: request.userId,
      entryType: "withdraw_release",
      direction: "credit",
      amount: freezeAmount,
      beforeBalance: balance.availableAmount,
      afterBalance: nextAvailableAmount,
      referenceType: "withdrawal_request",
      referenceId: request.id,
      memo: params.operatorNote ?? "withdrawal rejected",
    });

    return request.id;
  });
}

/**
 * 确认提现打款
 */
export async function markWithdrawalRequestPaid(params: {
  requestId: string;
  operatorUserId: string;
  operatorNote?: string;
}) {
  return await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, params.requestId))
      .limit(1);

    if (!request || request.status !== "pending") {
      throw new Error("Withdrawal request is not pending");
    }

    const [balance] = await tx
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, request.userId))
      .limit(1);

    if (!balance) {
      throw new Error("Commission balance not found");
    }

    const freezeAmount = request.amount + request.feeAmount;
    const nextFrozenAmount = Math.max(0, balance.frozenAmount - freezeAmount);
    const nextWithdrawnAmount = balance.withdrawnAmount + freezeAmount;

    await tx
      .update(withdrawalRequest)
      .set({
        status: "paid",
        operatorUserId: params.operatorUserId,
        operatorNote: params.operatorNote ?? null,
        reviewedAt: new Date(),
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequest.id, params.requestId));

    await tx
      .update(commissionBalance)
      .set({
        frozenAmount: nextFrozenAmount,
        withdrawnAmount: nextWithdrawnAmount,
        updatedAt: new Date(),
      })
      .where(eq(commissionBalance.id, balance.id));

    await tx.insert(commissionLedger).values({
      id: crypto.randomUUID(),
      userId: request.userId,
      entryType: "withdraw_paid",
      direction: "debit",
      amount: freezeAmount,
      beforeBalance: balance.frozenAmount,
      afterBalance: nextFrozenAmount,
      referenceType: "withdrawal_request",
      referenceId: request.id,
      memo: params.operatorNote ?? "withdrawal paid",
    });

    return request.id;
  });
}
