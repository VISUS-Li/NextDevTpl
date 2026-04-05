import { and, desc, eq } from "drizzle-orm";
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
