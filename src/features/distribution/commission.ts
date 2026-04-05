import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  commissionBalance,
  commissionEvent,
  commissionLedger,
  commissionRecord,
  commissionRule,
  salesOrder,
  salesOrderItem,
} from "@/db/schema";

/**
 * 佣金触发类型
 */
type CommissionTriggerType =
  | "credit_purchase"
  | "subscription_create"
  | "subscription_cycle";

/**
 * 计算佣金金额
 */
function calculateCommissionAmount(params: {
  baseAmount: number;
  calculationMode: "rate" | "fixed";
  rate: number | null;
  fixedAmount: number | null;
}) {
  if (params.calculationMode === "fixed") {
    return params.fixedAmount ?? 0;
  }

  return Math.round(params.baseAmount * ((params.rate ?? 0) / 100));
}

/**
 * 根据触发类型匹配当前规则
 */
async function findCommissionRule(params: {
  orderType: typeof salesOrder.$inferSelect.orderType;
  productType: typeof salesOrderItem.$inferSelect.productType;
  triggerType: CommissionTriggerType;
}) {
  const rules = await db
    .select()
    .from(commissionRule)
    .where(
      and(
        eq(commissionRule.status, "active"),
        eq(commissionRule.commissionLevel, 1)
      )
    )
    .orderBy(desc(commissionRule.priority), desc(commissionRule.createdAt));

  return (
    rules.find((rule) => {
      if (rule.orderType && rule.orderType !== params.orderType) {
        return false;
      }
      if (rule.productType && rule.productType !== params.productType) {
        return false;
      }
      if (
        params.triggerType === "credit_purchase" &&
        !rule.appliesToCreditPackage
      ) {
        return false;
      }
      if (
        params.triggerType === "subscription_create" &&
        !rule.appliesToFirstPurchase
      ) {
        return false;
      }
      if (
        params.triggerType === "subscription_cycle" &&
        !rule.appliesToRenewal
      ) {
        return false;
      }
      return true;
    }) ?? null
  );
}

/**
 * 为统一订单生成佣金冻结记录
 */
export async function settleCommissionForSalesOrder(
  orderId: string,
  triggerType: CommissionTriggerType
) {
  const [order] = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.id, orderId))
    .limit(1);

  if (!order?.attributedAgentUserId) {
    return null;
  }

  const [item] = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.orderId, orderId))
    .limit(1);

  if (!item || item.commissionBaseAmount <= 0) {
    return null;
  }

  const [existingEvent] = await db
    .select({ id: commissionEvent.id })
    .from(commissionEvent)
    .where(
      and(
        eq(commissionEvent.orderItemId, item.id),
        eq(commissionEvent.triggerType, triggerType)
      )
    )
    .limit(1);

  if (existingEvent) {
    return existingEvent.id;
  }

  const rule = await findCommissionRule({
    orderType: order.orderType,
    productType: item.productType,
    triggerType,
  });

  const eventId = crypto.randomUUID();
  if (!rule) {
    await db.insert(commissionEvent).values({
      id: eventId,
      orderId: order.id,
      orderItemId: item.id,
      triggerUserId: order.userId,
      triggerType,
      status: "skipped",
      currency: order.currency,
      commissionBaseAmount: item.commissionBaseAmount,
      settlementBasis: "rule_missing",
      attributionSnapshot: order.attributionSnapshot,
      errorMessage: "commission_rule_missing",
      executedAt: new Date(),
    });
    return eventId;
  }

  const commissionAmount = calculateCommissionAmount({
    baseAmount: item.commissionBaseAmount,
    calculationMode: rule.calculationMode,
    rate: rule.rate,
    fixedAmount: rule.fixedAmount,
  });

  await db.insert(commissionEvent).values({
    id: eventId,
    orderId: order.id,
    orderItemId: item.id,
    triggerUserId: order.userId,
    triggerType,
    status: "completed",
    currency: order.currency,
    commissionBaseAmount: item.commissionBaseAmount,
    settlementBasis: `level_${rule.commissionLevel}`,
    ruleSnapshot: {
      ruleId: rule.id,
      calculationMode: rule.calculationMode,
      rate: rule.rate,
      fixedAmount: rule.fixedAmount,
      freezeDays: rule.freezeDays,
    },
    attributionSnapshot: order.attributionSnapshot,
    executedAt: new Date(),
  });

  const availableAt = new Date(
    Date.now() + rule.freezeDays * 24 * 60 * 60 * 1000
  );
  const recordId = crypto.randomUUID();
  await db.insert(commissionRecord).values({
    id: recordId,
    eventId,
    beneficiaryUserId: order.attributedAgentUserId,
    sourceAgentUserId: order.attributedAgentUserId,
    commissionLevel: rule.commissionLevel,
    ruleId: rule.id,
    ruleSnapshot: {
      rate: rule.rate,
      fixedAmount: rule.fixedAmount,
      freezeDays: rule.freezeDays,
    },
    amount: commissionAmount,
    currency: order.currency,
    status: "frozen",
    availableAt,
    metadata: {
      orderId: order.id,
      orderItemId: item.id,
      triggerType,
    },
  });

  const [balance] = await db
    .select()
    .from(commissionBalance)
    .where(eq(commissionBalance.userId, order.attributedAgentUserId))
    .limit(1);

  const beforeFrozenAmount = balance?.frozenAmount ?? 0;
  const afterFrozenAmount = beforeFrozenAmount + commissionAmount;

  if (balance) {
    await db
      .update(commissionBalance)
      .set({
        totalEarned: balance.totalEarned + commissionAmount,
        frozenAmount: afterFrozenAmount,
        updatedAt: new Date(),
      })
      .where(eq(commissionBalance.id, balance.id));
  } else {
    await db.insert(commissionBalance).values({
      id: crypto.randomUUID(),
      userId: order.attributedAgentUserId,
      currency: order.currency,
      totalEarned: commissionAmount,
      availableAmount: 0,
      frozenAmount: commissionAmount,
      withdrawnAmount: 0,
      reversedAmount: 0,
    });
  }

  await db.insert(commissionLedger).values({
    id: crypto.randomUUID(),
    userId: order.attributedAgentUserId,
    recordId,
    entryType: "commission_frozen",
    direction: "credit",
    amount: commissionAmount,
    beforeBalance: beforeFrozenAmount,
    afterBalance: afterFrozenAmount,
    referenceType: "commission_record",
    referenceId: recordId,
    memo: `commission frozen for ${triggerType}`,
  });

  return eventId;
}

/**
 * 回冲订单项对应的冻结或可用佣金
 */
export async function reverseCommissionForSalesOrderItem(params: {
  orderItemId: string;
  afterSalesEventId: string;
  reason: string;
}) {
  const [orderItem] = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.id, params.orderItemId))
    .limit(1);

  if (!orderItem || orderItem.grossAmount <= 0 || orderItem.refundedAmount <= 0) {
    return [];
  }

  const events = await db
    .select()
    .from(commissionEvent)
    .where(eq(commissionEvent.orderItemId, params.orderItemId));

  if (events.length === 0) {
    return [];
  }

  const eventIds = events.map((event) => event.id);
  const records = await db
    .select()
    .from(commissionRecord)
    .where(
      eventIds.length === 1
        ? eq(commissionRecord.eventId, eventIds[0]!)
        : inArray(commissionRecord.eventId, eventIds)
    );

  if (records.length === 0) {
    return [];
  }

  const recordIds = records.map((record) => record.id);
  const reverseLedgers = await db
    .select()
    .from(commissionLedger)
    .where(
      recordIds.length === 1
        ? eq(commissionLedger.recordId, recordIds[0]!)
        : inArray(commissionLedger.recordId, recordIds)
    );

  const relevantReverseLedgers =
    recordIds.length <= 1
      ? reverseLedgers.filter((entry) => entry.entryType === "commission_reverse")
      : reverseLedgers.filter(
          (entry) =>
            entry.recordId && recordIds.includes(entry.recordId) &&
            entry.entryType === "commission_reverse"
        );

  const reversedEventIds: string[] = [];

  for (const record of records) {
    const alreadyReversed = relevantReverseLedgers
      .filter((entry) => entry.recordId === record.id)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const targetReversedAmount = Math.min(
      record.amount,
      Math.round((record.amount * orderItem.refundedAmount) / orderItem.grossAmount)
    );
    const reverseAmount = targetReversedAmount - alreadyReversed;

    if (reverseAmount <= 0) {
      continue;
    }

    const [balance] = await db
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, record.beneficiaryUserId))
      .limit(1);

    if (!balance) {
      continue;
    }

    const affectsAvailable = record.status === "available";
    const beforeBalance = affectsAvailable
      ? balance.availableAmount
      : balance.frozenAmount;
    const afterBalance = Math.max(0, beforeBalance - reverseAmount);

    await db
      .update(commissionBalance)
      .set({
        availableAmount: affectsAvailable
          ? afterBalance
          : balance.availableAmount,
        frozenAmount: affectsAvailable ? balance.frozenAmount : afterBalance,
        reversedAmount: balance.reversedAmount + reverseAmount,
        updatedAt: new Date(),
      })
      .where(eq(commissionBalance.id, balance.id));

    const fullyReversed = targetReversedAmount >= record.amount;
    await db
      .update(commissionRecord)
      .set({
        status: fullyReversed ? "reversed" : record.status,
        reversedAt: fullyReversed ? new Date() : record.reversedAt,
        reversalReason: params.reason,
        updatedAt: new Date(),
      })
      .where(eq(commissionRecord.id, record.id));

    const reverseLedgerId = crypto.randomUUID();
    await db.insert(commissionLedger).values({
      id: reverseLedgerId,
      userId: record.beneficiaryUserId,
      recordId: record.id,
      entryType: "commission_reverse",
      direction: "debit",
      amount: reverseAmount,
      beforeBalance,
      afterBalance,
      referenceType: "sales_after_sales_event",
      referenceId: params.afterSalesEventId,
      memo: params.reason,
    });

    reversedEventIds.push(reverseLedgerId);
  }

  return reversedEventIds;
}

/**
 * 将已到解冻时间的佣金转为可用
 */
export async function releaseAvailableCommissionRecords(now = new Date()) {
  const records = await db
    .select()
    .from(commissionRecord)
    .where(
      and(
        eq(commissionRecord.status, "frozen"),
        lte(commissionRecord.availableAt, now)
      )
    );

  const releasedRecordIds: string[] = [];

  for (const record of records) {
    const [balance] = await db
      .select()
      .from(commissionBalance)
      .where(eq(commissionBalance.userId, record.beneficiaryUserId))
      .limit(1);

    if (!balance) {
      continue;
    }

    const nextFrozenAmount = Math.max(0, balance.frozenAmount - record.amount);
    const nextAvailableAmount = balance.availableAmount + record.amount;

    await db
      .update(commissionRecord)
      .set({
        status: "available",
        updatedAt: new Date(),
      })
      .where(eq(commissionRecord.id, record.id));

    await db
      .update(commissionBalance)
      .set({
        frozenAmount: nextFrozenAmount,
        availableAmount: nextAvailableAmount,
        updatedAt: new Date(),
      })
      .where(eq(commissionBalance.id, balance.id));

    await db.insert(commissionLedger).values({
      id: crypto.randomUUID(),
      userId: record.beneficiaryUserId,
      recordId: record.id,
      entryType: "commission_available",
      direction: "credit",
      amount: record.amount,
      beforeBalance: balance.availableAmount,
      afterBalance: nextAvailableAmount,
      referenceType: "commission_record",
      referenceId: record.id,
      memo: "commission released to available",
    });

    releasedRecordIds.push(record.id);
  }

  return releasedRecordIds;
}
