import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { commissionBalance, commissionLedger, withdrawalRequest } from "@/db/schema";
import {
  createWithdrawalRequest,
  markWithdrawalRequestPaid,
  rejectWithdrawalRequest,
} from "@/features/distribution/withdrawal";
import { testDb, cleanupTestUsers, createTestUser } from "../utils";

/**
 * 提现流程测试
 */
describe("Distribution Withdrawal", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await cleanupTestUsers(createdUserIds);
  });

  it("应该创建提现申请并冻结可用余额", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: user.id,
      currency: "USD",
      totalEarned: 100,
      availableAmount: 80,
      frozenAmount: 20,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });

    const requestId = await createWithdrawalRequest({
      userId: user.id,
      amount: 50,
      currency: "USD",
      feeAmount: 5,
      payeeSnapshot: {
        method: "bank",
        accountName: "Test Agent",
      },
    });

    const [request] = await testDb
      .select()
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, requestId))
      .limit(1);
    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, user.id))
      .limit(1);
    const ledgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, user.id));

    expect(request!.status).toBe("pending");
    expect(request!.netAmount).toBe(45);
    expect(balance!.availableAmount).toBe(30);
    expect(balance!.frozenAmount).toBe(70);
    expect(ledgers.some((entry) => entry.entryType === "withdraw_freeze")).toBe(true);
  });

  it("拒绝提现后应该释放冻结余额", async () => {
    const user = await createTestUser();
    const operator = await createTestUser({ role: "admin" });
    createdUserIds.push(user.id, operator.id);

    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: user.id,
      currency: "USD",
      totalEarned: 100,
      availableAmount: 60,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });

    const requestId = await createWithdrawalRequest({
      userId: user.id,
      amount: 40,
      currency: "USD",
    });

    await rejectWithdrawalRequest({
      requestId,
      operatorUserId: operator.id,
      operatorNote: "manual reject",
    });

    const [request] = await testDb
      .select()
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, requestId))
      .limit(1);
    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, user.id))
      .limit(1);

    expect(request!.status).toBe("rejected");
    expect(balance!.availableAmount).toBe(60);
    expect(balance!.frozenAmount).toBe(0);
  });

  it("打款后应该增加已提现金额", async () => {
    const user = await createTestUser();
    const operator = await createTestUser({ role: "admin" });
    createdUserIds.push(user.id, operator.id);

    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: user.id,
      currency: "USD",
      totalEarned: 120,
      availableAmount: 90,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });

    const requestId = await createWithdrawalRequest({
      userId: user.id,
      amount: 70,
      currency: "USD",
    });

    await markWithdrawalRequestPaid({
      requestId,
      operatorUserId: operator.id,
      operatorNote: "paid",
    });

    const [request] = await testDb
      .select()
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, requestId))
      .limit(1);
    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, user.id))
      .limit(1);
    const ledgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, user.id));

    expect(request!.status).toBe("paid");
    expect(balance!.availableAmount).toBe(20);
    expect(balance!.frozenAmount).toBe(0);
    expect(balance!.withdrawnAmount).toBe(70);
    expect(ledgers.some((entry) => entry.entryType === "withdraw_paid")).toBe(true);
  });
});
