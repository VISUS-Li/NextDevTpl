import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  commissionBalance,
  commissionLedger,
  withdrawalRequest,
} from "@/db/schema";
import {
  createWithdrawalRequest,
  markWithdrawalRequestPaid,
  rejectWithdrawalRequest,
} from "@/features/distribution/withdrawal";
import { cleanupTestUsers, createTestUser, testDb } from "../utils";

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
    expect(balance!.availableAmount).toBe(25);
    expect(balance!.frozenAmount).toBe(75);
    expect(
      ledgers.find((entry) => entry.entryType === "withdraw_freeze")?.amount
    ).toBe(55);
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
    expect(ledgers.some((entry) => entry.entryType === "withdraw_paid")).toBe(
      true
    );
  });

  it("提现手续费应该一并冻结并在打款后计入已提现金额", async () => {
    const user = await createTestUser();
    const operator = await createTestUser({ role: "admin" });
    createdUserIds.push(user.id, operator.id);

    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: user.id,
      currency: "USD",
      totalEarned: 150,
      availableAmount: 150,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });

    const requestId = await createWithdrawalRequest({
      userId: user.id,
      amount: 100,
      feeAmount: 8,
      currency: "USD",
    });

    await markWithdrawalRequestPaid({
      requestId,
      operatorUserId: operator.id,
    });

    const [balance] = await testDb
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, user.id))
      .limit(1);
    const ledgers = await testDb
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.userId, user.id));

    expect(balance!.availableAmount).toBe(42);
    expect(balance!.frozenAmount).toBe(0);
    expect(balance!.withdrawnAmount).toBe(108);
    expect(
      ledgers.find((entry) => entry.entryType === "withdraw_freeze")?.amount
    ).toBe(108);
    expect(
      ledgers.find((entry) => entry.entryType === "withdraw_paid")?.amount
    ).toBe(108);
  });

  it("非法提现金额和币种不匹配应该拒绝", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: user.id,
      currency: "USD",
      totalEarned: 80,
      availableAmount: 80,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });

    await expect(
      createWithdrawalRequest({
        userId: user.id,
        amount: 0,
        currency: "USD",
      })
    ).rejects.toThrow("Withdrawal amount must be greater than 0");

    await expect(
      createWithdrawalRequest({
        userId: user.id,
        amount: 30,
        feeAmount: 31,
        currency: "USD",
      })
    ).rejects.toThrow("Withdrawal fee amount is invalid");

    await expect(
      createWithdrawalRequest({
        userId: user.id,
        amount: 30,
        currency: "EUR",
      })
    ).rejects.toThrow("Withdrawal currency does not match commission balance");
  });

  it("创建提现时账本写入失败应该整体回滚", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    await testDb.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: user.id,
      currency: "USD",
      totalEarned: 90,
      availableAmount: 90,
      frozenAmount: 0,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });

    const duplicateLedgerId = `withdraw_ledger_dup_${Date.now()}`;
    const requestId = `withdraw_request_tx_${Date.now()}`;
    await testDb.insert(commissionLedger).values({
      id: duplicateLedgerId,
      userId: user.id,
      entryType: "withdraw_freeze",
      direction: "debit",
      amount: 1,
      beforeBalance: 1,
      afterBalance: 0,
      referenceType: "seed",
      referenceId: "seed",
      memo: "seed",
    });

    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(requestId)
      .mockReturnValueOnce(duplicateLedgerId);

    await expect(
      createWithdrawalRequest({
        userId: user.id,
        amount: 40,
        feeAmount: 5,
        currency: "USD",
      })
    ).rejects.toThrow();

    uuidSpy.mockRestore();

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

    expect(request).toBeUndefined();
    expect(balance!.availableAmount).toBe(90);
    expect(balance!.frozenAmount).toBe(0);
    expect(ledgers).toHaveLength(1);
  });
});
