import crypto from "node:crypto";

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";

import {
  getBaseUrl,
  getPlanPriceById,
  SUBSCRIPTION_MONTHLY_CREDITS,
} from "@/config/payment";
import { db } from "@/db";
import {
  creditsBatch,
  type SalesOrderProvider,
  type SubscriptionBilling,
  type SubscriptionContract,
  salesOrder,
  salesOrderItem,
  subscription,
  subscriptionBilling,
  subscriptionContract,
} from "@/db/schema";
import { grantCredits } from "@/features/credits/core";
import { settleCommissionForSalesOrder } from "@/features/distribution/commission";
import {
  cancelRecurringProviderContract,
  createRecurringProviderSigningUrl,
  dispatchRecurringProviderBilling,
  queryRecurringProviderBilling,
  queryRecurringProviderContract,
} from "@/features/payment/recurring-provider-service";
import { PlanInterval } from "@/features/payment/types";

type SupportedRecurringProvider = Extract<
  SalesOrderProvider,
  "wechat_pay" | "alipay"
>;

type SupportedPlanId = "starter" | "pro" | "ultra";

type CreateRecurringContractParams = {
  userId: string;
  provider: SupportedRecurringProvider;
  planId: SupportedPlanId;
  interval: PlanInterval;
  baseUrl: string;
};

type ActivateRecurringContractParams = {
  contractId: string;
  providerContractId: string;
  providerExternalUserId?: string | null;
  rawResponse?: Record<string, unknown> | null;
  nextBillingAt?: Date;
};

type CancelRecurringContractParams = {
  contractId: string;
  userId: string;
};

type TriggerRecurringBillingParams = {
  contractId: string;
};

type SettleRecurringBillingParams = {
  outTradeNo: string;
  providerPaymentId?: string | null;
  paidAt?: Date;
  eventType: string;
  eventIdempotencyKey: string;
  rawResponse?: Record<string, unknown> | null;
};

/**
 * 连续扣费签约摘要。
 */
export type SubscriptionContractSummary = {
  id: string;
  provider: SupportedRecurringProvider;
  planId: SupportedPlanId;
  interval: PlanInterval;
  priceId: string;
  amount: number;
  currency: string;
  status: SubscriptionContract["status"];
  signingUrl: string | null;
  providerContractId: string | null;
  nextBillingAt: Date | null;
  pendingPlanId: SupportedPlanId | null;
  pendingInterval: PlanInterval | null;
  pendingAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 创建连续扣费签约。
 */
export async function createSubscriptionContractIntent(
  params: CreateRecurringContractParams
) {
  await assertNoActiveAutoRenewContract(params.userId);
  const price = getPlanPriceById(params.planId, params.interval);
  if (!price) {
    throw new Error("订阅计划价格未配置");
  }
  const priceId = price.priceId || `${params.planId}_${params.interval}`;

  const created = await db
    .insert(subscriptionContract)
    .values({
      id: crypto.randomUUID(),
      userId: params.userId,
      provider: params.provider,
      planId: params.planId,
      priceId,
      billingInterval: params.interval,
      currency: "CNY",
      amount: Math.round(price.amount * 100),
      status: "pending_sign",
      metadata: {
        baseUrl: params.baseUrl,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then((rows) => rows[0]);

  if (!created) {
    throw new Error("创建连续扣费签约失败");
  }

  const signingUrl = await createRecurringProviderSigningUrl({
    contract: created,
    baseUrl: params.baseUrl,
  });

  const [updated] = await db
    .update(subscriptionContract)
    .set({
      signingUrl,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, created.id))
    .returning();

  if (!updated) {
    throw new Error("更新签约链接失败");
  }

  return {
    contract: toContractSummary(updated),
  };
}

/**
 * 读取用户自己的连续扣费签约。
 */
export async function getUserSubscriptionContract(
  contractId: string,
  userId: string
) {
  const [current] = await db
    .select()
    .from(subscriptionContract)
    .where(
      and(
        eq(subscriptionContract.id, contractId),
        eq(subscriptionContract.userId, userId)
      )
    )
    .limit(1);
  return current ? toContractSummary(current) : null;
}

/**
 * 列出用户自己的连续扣费签约。
 */
export async function listUserSubscriptionContracts(userId: string) {
  const rows = await db
    .select()
    .from(subscriptionContract)
    .where(eq(subscriptionContract.userId, userId))
    .orderBy(desc(subscriptionContract.createdAt));

  return rows.map((item) => toContractSummary(item));
}

/**
 * 取消当前用户自己的连续扣费签约。
 */
export async function cancelUserSubscriptionContract(
  params: CancelRecurringContractParams
) {
  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(
      and(
        eq(subscriptionContract.id, params.contractId),
        eq(subscriptionContract.userId, params.userId)
      )
    )
    .limit(1);

  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }
  if (!["pending_sign", "active", "paused"].includes(contract.status)) {
    throw new Error("当前签约状态不允许解约");
  }

  await cancelRecurringProviderContract(contract);
  const [updated] = await db
    .update(subscriptionContract)
    .set({
      status: "terminated",
      terminatedAt: new Date(),
      nextBillingAt: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, contract.id))
    .returning();

  if (!updated) {
    throw new Error("更新连续扣费签约失败");
  }

  await db
    .update(subscription)
    .set({
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    })
    .where(eq(subscription.userId, contract.userId));

  return toContractSummary(updated);
}

/**
 * 为下一个账期安排套餐变更。
 */
export async function scheduleSubscriptionContractPlanChange(params: {
  contractId: string;
  userId: string;
  planId: SupportedPlanId;
  interval: PlanInterval;
}) {
  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(
      and(
        eq(subscriptionContract.id, params.contractId),
        eq(subscriptionContract.userId, params.userId)
      )
    )
    .limit(1);

  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }
  if (!["active", "paused"].includes(contract.status)) {
    throw new Error("当前签约状态不允许变更套餐");
  }

  const price = getPlanPriceById(params.planId, params.interval);
  if (!price) {
    throw new Error("目标订阅计划价格未配置");
  }
  if (
    contract.planId === params.planId &&
    contract.billingInterval === params.interval
  ) {
    throw new Error("新套餐与当前套餐一致");
  }

  const [updated] = await db
    .update(subscriptionContract)
    .set({
      metadata: mergeMetadata(contract.metadata, {
        pendingPlanChange: {
          planId: params.planId,
          interval: params.interval,
          priceId: price.priceId || `${params.planId}_${params.interval}`,
          amount: Math.round(price.amount * 100),
          requestedAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, contract.id))
    .returning();

  if (!updated) {
    throw new Error("保存套餐变更失败");
  }

  return toContractSummary(updated);
}

/**
 * 激活连续扣费签约。
 */
export async function activateSubscriptionContract(
  params: ActivateRecurringContractParams
) {
  const [updated] = await db
    .update(subscriptionContract)
    .set({
      providerContractId: params.providerContractId,
      providerExternalUserId: params.providerExternalUserId ?? null,
      status: "active",
      signedAt: new Date(),
      nextBillingAt: params.nextBillingAt ?? new Date(),
      metadata: params.rawResponse ?? null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, params.contractId))
    .returning();

  if (!updated) {
    throw new Error("连续扣费签约不存在");
  }
  return toContractSummary(updated);
}

/**
 * 生成下一期账单。
 */
export async function triggerSubscriptionBilling(
  params: TriggerRecurringBillingParams
) {
  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(eq(subscriptionContract.id, params.contractId))
    .limit(1);

  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }
  if (contract.status !== "active") {
    throw new Error("连续扣费签约未激活");
  }

  const [latestBilling] = await db
    .select()
    .from(subscriptionBilling)
    .where(eq(subscriptionBilling.contractId, contract.id))
    .orderBy(desc(subscriptionBilling.billingSequence))
    .limit(1);

  const periodStart =
    latestBilling?.periodEnd ?? contract.nextBillingAt ?? new Date();
  const [existingCurrentBilling] = await db
    .select()
    .from(subscriptionBilling)
    .where(
      and(
        eq(subscriptionBilling.contractId, contract.id),
        eq(subscriptionBilling.periodStart, periodStart)
      )
    )
    .orderBy(desc(subscriptionBilling.createdAt))
    .limit(1);

  if (
    existingCurrentBilling &&
    ["scheduled", "processing", "paid"].includes(existingCurrentBilling.status)
  ) {
    return existingCurrentBilling;
  }

  const pendingPlanChange = readPendingPlanChange(contract.metadata);
  const currentInterval = contract.billingInterval as PlanInterval;
  const billingPlanId = pendingPlanChange?.planId ?? contract.planId;
  const billingInterval = pendingPlanChange?.interval ?? currentInterval;
  const billingPriceId = pendingPlanChange?.priceId ?? contract.priceId;
  const billingAmount = pendingPlanChange?.amount ?? contract.amount;
  const periodEnd = addIntervalDate(periodStart, billingInterval);
  const sequence = (latestBilling?.billingSequence ?? 0) + 1;
  const outTradeNo = buildRecurringOutTradeNo(
    contract.provider as SupportedRecurringProvider,
    contract.userId
  );
  const providerOrderId =
    process.env.PAYMENT_MOCK_MODE === "true" ? outTradeNo : null;

  const [created] = await db
    .insert(subscriptionBilling)
    .values({
      id: crypto.randomUUID(),
      contractId: contract.id,
      userId: contract.userId,
      subscriptionRecordId: contract.subscriptionRecordId,
      provider: contract.provider,
      planId: billingPlanId,
      priceId: billingPriceId,
      billingSequence: sequence,
      periodStart,
      periodEnd,
      amount: billingAmount,
      currency: contract.currency,
      outTradeNo,
      providerOrderId,
      status: "processing",
      metadata: {
        providerContractId: contract.providerContractId,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new Error("创建连续扣费账单失败");
  }

  const baseUrl = readStringMetadata(contract.metadata, "baseUrl") || getBaseUrl();

  try {
    const dispatch = await dispatchRecurringProviderBilling({
      contract,
      billing: created,
      baseUrl,
    });
    const [updated] = await db
      .update(subscriptionBilling)
      .set({
        providerOrderId: dispatch.providerOrderId,
        providerPaymentId: dispatch.providerPaymentId,
        status: dispatch.status,
        metadata: {
          providerContractId: contract.providerContractId,
          providerDispatch: dispatch.rawResponse,
        },
        updatedAt: new Date(),
      })
      .where(eq(subscriptionBilling.id, created.id))
      .returning();

    if (!updated) {
      throw new Error("回写连续扣费发单结果失败");
    }
    return updated;
  } catch (error) {
    await db
      .update(subscriptionBilling)
      .set({
        status: "failed",
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message : "dispatch failed",
        updatedAt: new Date(),
      })
      .where(eq(subscriptionBilling.id, created.id));
    throw error;
  }
}

/**
 * 处理到期连续扣费账单。
 */
export async function processDueSubscriptionBillings(params?: {
  limit?: number;
  now?: Date;
}) {
  const now = params?.now ?? new Date();
  const limit = params?.limit ?? 20;
  const contracts = await db
    .select({ id: subscriptionContract.id })
    .from(subscriptionContract)
    .where(
      and(
        eq(subscriptionContract.status, "active"),
        lte(subscriptionContract.nextBillingAt, now)
      )
    )
    .orderBy(asc(subscriptionContract.nextBillingAt))
    .limit(limit);

  const results = [];
  for (const contract of contracts) {
    try {
      const billing = await triggerSubscriptionBilling({
        contractId: contract.id,
      });
      results.push({
        contractId: contract.id,
        billingId: billing.id,
        status: billing.status,
      });
    } catch (error) {
      results.push({
        contractId: contract.id,
        billingId: null,
        status: "failed",
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return results;
}

/**
 * 同步渠道侧签约状态到本地。
 */
export async function syncSubscriptionContractStatus(contractId: string) {
  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(eq(subscriptionContract.id, contractId))
    .limit(1);

  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }

  const providerState = await queryRecurringProviderContract(contract);
  const [updated] = await db
    .update(subscriptionContract)
    .set({
      providerContractId: providerState.providerContractId,
      status: providerState.status,
      nextBillingAt: providerState.nextBillingAt ?? contract.nextBillingAt,
      metadata: mergeMetadata(contract.metadata, {
        providerQuery: providerState.rawResponse,
      }),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, contract.id))
    .returning();

  if (!updated) {
    throw new Error("更新连续扣费签约失败");
  }

  return toContractSummary(updated);
}

/**
 * 同步渠道侧账单状态到本地。
 */
export async function syncSubscriptionBillingStatus(billingId: string) {
  const [billing] = await db
    .select()
    .from(subscriptionBilling)
    .where(eq(subscriptionBilling.id, billingId))
    .limit(1);

  if (!billing) {
    throw new Error("连续扣费账单不存在");
  }

  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(eq(subscriptionContract.id, billing.contractId))
    .limit(1);
  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }

  const providerState = await queryRecurringProviderBilling({
    contract,
    billing,
  });

  if (providerState.status === "paid") {
    const result = await settleSubscriptionBillingPaid({
      outTradeNo: billing.outTradeNo,
      providerPaymentId: providerState.providerPaymentId,
      paidAt: providerState.paidAt ?? new Date(),
      eventType: `${billing.provider}.subscription.billing.sync_paid`,
      eventIdempotencyKey: `${billing.provider}:subscription.billing.sync:${billing.outTradeNo}:paid`,
      rawResponse: providerState.rawResponse,
    });
    return result.billing;
  }

  if (providerState.status === "failed") {
    return markSubscriptionBillingFailed({
      billingId: billing.id,
      providerPaymentId: providerState.providerPaymentId,
      failureReason: providerState.failureReason ?? "provider failed",
      rawResponse: providerState.rawResponse,
    });
  }

  const [updated] = await db
    .update(subscriptionBilling)
    .set({
      providerPaymentId: providerState.providerPaymentId,
      metadata: mergeMetadata(billing.metadata, {
        providerQuery: providerState.rawResponse,
      }),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionBilling.id, billing.id))
    .returning();

  if (!updated) {
    throw new Error("更新连续扣费账单失败");
  }

  return updated;
}

/**
 * 回写连续扣费失败结果。
 */
export async function markSubscriptionBillingFailed(params: {
  billingId?: string;
  outTradeNo?: string;
  providerPaymentId?: string | null;
  failureReason: string;
  rawResponse?: Record<string, unknown> | null;
}) {
  const [billing] = params.billingId
    ? await db
        .select()
        .from(subscriptionBilling)
        .where(eq(subscriptionBilling.id, params.billingId))
        .limit(1)
    : await db
        .select()
        .from(subscriptionBilling)
        .where(eq(subscriptionBilling.outTradeNo, params.outTradeNo ?? ""))
        .limit(1);

  if (!billing) {
    throw new Error("连续扣费账单不存在");
  }
  if (billing.status === "paid") {
    return billing;
  }

  const [updated] = await db
    .update(subscriptionBilling)
    .set({
      providerPaymentId: params.providerPaymentId ?? billing.providerPaymentId,
      status: "failed",
      failedAt: new Date(),
      failureReason: params.failureReason,
      metadata: mergeMetadata(billing.metadata, {
        providerFailure: params.rawResponse ?? null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionBilling.id, billing.id))
    .returning();

  if (!updated) {
    throw new Error("回写连续扣费失败状态失败");
  }

  await pauseContractAfterContinuousFailures(updated.contractId);
  return updated;
}

/**
 * 管理员手工补扣失败账单。
 */
export async function retrySubscriptionBilling(billingId: string) {
  const [billing] = await db
    .select()
    .from(subscriptionBilling)
    .where(eq(subscriptionBilling.id, billingId))
    .limit(1);

  if (!billing) {
    throw new Error("连续扣费账单不存在");
  }
  if (billing.status !== "failed") {
    throw new Error("当前账单不是失败状态，不能手工补扣");
  }

  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(eq(subscriptionContract.id, billing.contractId))
    .limit(1);
  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }
  if (!["active", "paused"].includes(contract.status)) {
    throw new Error("当前签约状态不允许手工补扣");
  }

  const baseUrl = readStringMetadata(contract.metadata, "baseUrl") || getBaseUrl();
  const dispatch = await dispatchRecurringProviderBilling({
    contract,
    billing,
    baseUrl,
  });
  const nextStatus =
    contract.status === "paused" && dispatch.status !== "scheduled"
      ? "active"
      : contract.status;

  const [updatedBilling] = await db
    .update(subscriptionBilling)
    .set({
      providerOrderId: dispatch.providerOrderId,
      providerPaymentId: dispatch.providerPaymentId,
      status: dispatch.status,
      failedAt: null,
      failureReason: null,
      metadata: mergeMetadata(billing.metadata, {
        providerRetryDispatch: dispatch.rawResponse,
      }),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionBilling.id, billing.id))
    .returning();

  if (!updatedBilling) {
    throw new Error("回写手工补扣结果失败");
  }

  await db
    .update(subscriptionContract)
    .set({
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, contract.id));

  return updatedBilling;
}

/**
 * 处理连续扣费成功回调。
 */
export async function settleSubscriptionBillingPaid(
  params: SettleRecurringBillingParams
) {
  const [billing] = await db
    .select()
    .from(subscriptionBilling)
    .where(eq(subscriptionBilling.outTradeNo, params.outTradeNo))
    .limit(1);

  if (!billing) {
    throw new Error("连续扣费账单不存在");
  }

  const paidBilling =
    billing.status === "paid"
      ? billing
      : await db
          .update(subscriptionBilling)
          .set({
            providerPaymentId: params.providerPaymentId ?? null,
            status: "paid",
            paidAt: params.paidAt ?? new Date(),
            metadata: params.rawResponse ?? null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionBilling.id, billing.id))
          .returning()
          .then((rows) => rows[0]);

  if (!paidBilling) {
    throw new Error("回写连续扣费账单失败");
  }

  const [contract] = await db
    .select()
    .from(subscriptionContract)
    .where(eq(subscriptionContract.id, paidBilling.contractId))
    .limit(1);
  if (!contract) {
    throw new Error("连续扣费签约不存在");
  }

  const localSubscription = await upsertRecurringSubscriptionRecord(
    contract,
    paidBilling
  );
  await upsertRecurringSubscriptionOrder({
    contract,
    billing: paidBilling,
    subscriptionRecord: localSubscription,
    eventType: params.eventType,
    eventIdempotencyKey: params.eventIdempotencyKey,
  });
  await grantRecurringSubscriptionCredits(contract, paidBilling);
  const salesOrderId = await findRecurringSalesOrderId(
    params.eventIdempotencyKey
  );
  if (salesOrderId) {
    await settleCommissionForSalesOrder(salesOrderId, "subscription_cycle");
  }

  await db
    .update(subscriptionContract)
    .set({
      planId: paidBilling.planId,
      priceId: paidBilling.priceId,
      amount: paidBilling.amount,
      billingInterval: deriveBillingInterval(contract, paidBilling),
      subscriptionRecordId: localSubscription.id,
      nextBillingAt: paidBilling.periodEnd,
      metadata: clearPendingPlanChange(contract.metadata),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, contract.id));

  return {
    contract: toContractSummary({
      ...contract,
      planId: paidBilling.planId,
      priceId: paidBilling.priceId,
      amount: paidBilling.amount,
      billingInterval: deriveBillingInterval(contract, paidBilling),
      subscriptionRecordId: localSubscription.id,
      nextBillingAt: paidBilling.periodEnd,
      metadata: clearPendingPlanChange(contract.metadata),
    }),
    billing: paidBilling,
  };
}

async function pauseContractAfterContinuousFailures(contractId: string) {
  const recentBillings = await db
    .select({
      id: subscriptionBilling.id,
      status: subscriptionBilling.status,
    })
    .from(subscriptionBilling)
    .where(eq(subscriptionBilling.contractId, contractId))
    .orderBy(desc(subscriptionBilling.billingSequence))
    .limit(3);

  if (
    recentBillings.length < 3 ||
    recentBillings.some((item) => item.status !== "failed")
  ) {
    return;
  }

  await db
    .update(subscriptionContract)
    .set({
      status: "paused",
      updatedAt: new Date(),
    })
    .where(eq(subscriptionContract.id, contractId));
}

async function assertNoActiveAutoRenewContract(userId: string) {
  const [existingContract] = await db
    .select({ id: subscriptionContract.id })
    .from(subscriptionContract)
    .where(
      and(
        eq(subscriptionContract.userId, userId),
        inArray(subscriptionContract.status, [
          "pending_sign",
          "active",
          "paused",
        ])
      )
    )
    .limit(1);

  if (existingContract) {
    throw new Error("当前用户已有连续扣费签约，请先解约后再创建新签约");
  }

  const [existingSubscription] = await db
    .select({ status: subscription.status })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);

  if (
    existingSubscription &&
    ["active", "trialing", "lifetime"].includes(existingSubscription.status)
  ) {
    throw new Error("当前用户已有活动订阅，请先停用后再切换连续扣费");
  }
}

async function upsertRecurringSubscriptionRecord(
  contract: SubscriptionContract,
  billing: SubscriptionBilling
) {
  const [existing] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, contract.userId))
    .limit(1);

  const values = {
    subscriptionId: contract.providerContractId ?? contract.id,
    priceId: contract.priceId,
    status: "active",
    currentPeriodStart: billing.periodStart,
    currentPeriodEnd: billing.periodEnd,
    cancelAtPeriodEnd: false,
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await db
      .update(subscription)
      .set(values)
      .where(eq(subscription.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error("更新订阅记录失败");
    }
    return updated;
  }

  const [created] = await db
    .insert(subscription)
    .values({
      id: crypto.randomUUID(),
      userId: contract.userId,
      ...values,
    })
    .returning();

  if (!created) {
    throw new Error("创建订阅记录失败");
  }
  return created;
}

async function upsertRecurringSubscriptionOrder(params: {
  contract: SubscriptionContract;
  billing: SubscriptionBilling;
  subscriptionRecord: typeof subscription.$inferSelect;
  eventType: string;
  eventIdempotencyKey: string;
}) {
  const [existingOrder] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(eq(salesOrder.eventIdempotencyKey, params.eventIdempotencyKey))
    .limit(1);

  if (existingOrder) {
    return existingOrder.id;
  }

  const orderId = crypto.randomUUID();
  await db.insert(salesOrder).values({
    id: orderId,
    userId: params.contract.userId,
    provider: params.contract.provider,
    providerOrderId:
      params.billing.providerOrderId ?? params.billing.outTradeNo,
    providerCheckoutId: null,
    providerSubscriptionId:
      params.contract.providerContractId ??
      params.subscriptionRecord.subscriptionId,
    providerPaymentId:
      params.billing.providerPaymentId ??
      params.billing.providerOrderId ??
      params.billing.outTradeNo,
    orderType: "subscription",
    status: "paid",
    afterSalesStatus: "none",
    currency: params.billing.currency,
    grossAmount: params.billing.amount,
    paidAt: params.billing.paidAt ?? new Date(),
    eventTime: params.billing.paidAt ?? new Date(),
    eventType: params.eventType,
    eventIdempotencyKey: params.eventIdempotencyKey,
    metadata: {
      contractId: params.contract.id,
      billingId: params.billing.id,
      planId: params.contract.planId,
      priceId: params.contract.priceId,
      interval: params.contract.billingInterval,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(salesOrderItem).values({
    id: crypto.randomUUID(),
    orderId,
    productType: "subscription",
    productId: params.contract.planId,
    priceId: params.contract.priceId,
    planId: params.contract.planId,
    quantity: 1,
    grossAmount: params.billing.amount,
    netAmount: params.billing.amount,
    commissionBaseAmount: params.billing.amount,
    refundableAmount: params.billing.amount,
    refundedAmount: 0,
    metadata: {
      contractId: params.contract.id,
      billingId: params.billing.id,
      credits:
        SUBSCRIPTION_MONTHLY_CREDITS[
          params.contract.planId as keyof typeof SUBSCRIPTION_MONTHLY_CREDITS
        ] ?? 0,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return orderId;
}

async function grantRecurringSubscriptionCredits(
  contract: SubscriptionContract,
  billing: SubscriptionBilling
) {
  const monthlyCredits =
    SUBSCRIPTION_MONTHLY_CREDITS[
      contract.planId as keyof typeof SUBSCRIPTION_MONTHLY_CREDITS
    ];
  if (!monthlyCredits) {
    throw new Error(`未配置订阅积分: ${contract.planId}`);
  }

  const issueAmount =
    contract.billingInterval === PlanInterval.YEAR
      ? monthlyCredits * 12
      : monthlyCredits;
  const periodKey = `${contract.id}:${billing.periodStart.toISOString()}`;
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceType, "subscription"),
        eq(creditsBatch.sourceRef, periodKey)
      )
    )
    .limit(1);

  if (existingBatch) {
    return existingBatch.id;
  }

  const result = await grantCredits({
    userId: contract.userId,
    amount: issueAmount,
    sourceType: "subscription",
    debitAccount: `SUBSCRIPTION:${contract.id}`,
    transactionType: "monthly_grant",
    sourceRef: periodKey,
    description:
      contract.billingInterval === PlanInterval.YEAR
        ? `${contract.planId} 年度订阅积分`
        : `${contract.planId} 月度订阅积分`,
    metadata: {
      contractId: contract.id,
      billingId: billing.id,
      planId: contract.planId,
      priceId: contract.priceId,
      interval: contract.billingInterval,
    },
  });

  return result.batchId;
}

async function findRecurringSalesOrderId(eventIdempotencyKey: string) {
  const [order] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(eq(salesOrder.eventIdempotencyKey, eventIdempotencyKey))
    .limit(1);
  return order?.id ?? null;
}

function addIntervalDate(value: Date, interval: PlanInterval) {
  const next = new Date(value);
  if (interval === PlanInterval.YEAR) {
    next.setFullYear(next.getFullYear() + 1);
    return next;
  }
  next.setMonth(next.getMonth() + 1);
  return next;
}

function buildRecurringOutTradeNo(
  provider: SupportedRecurringProvider,
  userId: string
) {
  const userPart = userId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "user";
  const providerPart = provider.replace(/[^a-zA-Z0-9]/g, "");
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `sub_${providerPart}_${userPart}_${Date.now()}_${randomPart}`;
}

function toContractSummary(
  contract: SubscriptionContract
): SubscriptionContractSummary {
  const pendingPlanChange = readPendingPlanChange(contract.metadata);
  return {
    id: contract.id,
    provider: contract.provider as SupportedRecurringProvider,
    planId: contract.planId as SupportedPlanId,
    interval: contract.billingInterval as PlanInterval,
    priceId: contract.priceId,
    amount: contract.amount,
    currency: contract.currency,
    status: contract.status,
    signingUrl: contract.signingUrl,
    providerContractId: contract.providerContractId,
    nextBillingAt: contract.nextBillingAt,
    pendingPlanId: pendingPlanChange?.planId ?? null,
    pendingInterval: pendingPlanChange?.interval ?? null,
    pendingAmount: pendingPlanChange?.amount ?? null,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

/**
 * 读取签约元数据中的字符串字段。
 */
function readStringMetadata(
  value: Record<string, unknown> | null | undefined,
  key: string
) {
  const field = value?.[key];
  return typeof field === "string" && field ? field : null;
}

/**
 * 合并 JSON 元数据，避免覆盖已有字段。
 */
function mergeMetadata(
  current: Record<string, unknown> | null | undefined,
  extra: Record<string, unknown>
) {
  return {
    ...(current ?? {}),
    ...extra,
  };
}

/**
 * 读取待生效的套餐变更。
 */
function readPendingPlanChange(
  metadata: Record<string, unknown> | null | undefined
): {
  planId: SupportedPlanId;
  interval: PlanInterval;
  priceId: string;
  amount: number;
} | null {
  const value = metadata?.pendingPlanChange;
  if (!value || typeof value !== "object") {
    return null;
  }

  const planId = readStringMetadata(value as Record<string, unknown>, "planId");
  const interval = readStringMetadata(
    value as Record<string, unknown>,
    "interval"
  );
  const priceId = readStringMetadata(value as Record<string, unknown>, "priceId");
  const amount = Number((value as Record<string, unknown>).amount);
  if (
    !planId ||
    !interval ||
    !priceId ||
    !Number.isFinite(amount) ||
    !["starter", "pro", "ultra"].includes(planId) ||
    !Object.values(PlanInterval).includes(interval as PlanInterval)
  ) {
    return null;
  }

  return {
    planId: planId as SupportedPlanId,
    interval: interval as PlanInterval,
    priceId,
    amount,
  };
}

/**
 * 清掉已生效的套餐变更字段。
 */
function clearPendingPlanChange(
  metadata: Record<string, unknown> | null | undefined
) {
  if (!metadata?.pendingPlanChange) {
    return metadata ?? null;
  }

  const next = { ...(metadata ?? {}) };
  delete next.pendingPlanChange;
  return next;
}

/**
 * 依据账单周期推导当前协议账期。
 */
function deriveBillingInterval(
  contract: SubscriptionContract,
  billing: SubscriptionBilling
) {
  const pendingPlanChange = readPendingPlanChange(contract.metadata);
  if (pendingPlanChange && pendingPlanChange.planId === billing.planId) {
    return pendingPlanChange.interval;
  }
  return contract.billingInterval;
}
