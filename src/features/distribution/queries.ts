import { and, count, desc, eq, isNotNull, ne, sum } from "drizzle-orm";

import { db } from "@/db";
import {
  commissionBalance,
  commissionRecord,
  distributionProfile,
  distributionReferralCode,
  salesOrder,
  user,
  withdrawalRequest,
} from "@/db/schema";

/**
 * 读取代理端分销中心所需的数据
 */
export async function getDistributionDashboardData(userId: string) {
  const [
    profile,
    balance,
    referralCodes,
    orders,
    commissionRecords,
    withdrawals,
    attributedOrdersResult,
    refundedOrdersResult,
    pendingWithdrawalsResult,
  ] = await Promise.all([
    db.query.distributionProfile.findFirst({
      where: eq(distributionProfile.userId, userId),
    }),
    db.query.commissionBalance.findFirst({
      where: eq(commissionBalance.userId, userId),
    }),
    db.query.distributionReferralCode.findMany({
      where: eq(distributionReferralCode.agentUserId, userId),
      orderBy: [desc(distributionReferralCode.createdAt)],
      limit: 6,
    }),
    db.query.salesOrder.findMany({
      where: eq(salesOrder.attributedAgentUserId, userId),
      orderBy: [desc(salesOrder.paidAt), desc(salesOrder.createdAt)],
      limit: 8,
    }),
    db.query.commissionRecord.findMany({
      where: eq(commissionRecord.beneficiaryUserId, userId),
      orderBy: [desc(commissionRecord.createdAt)],
      limit: 8,
    }),
    db.query.withdrawalRequest.findMany({
      where: eq(withdrawalRequest.userId, userId),
      orderBy: [desc(withdrawalRequest.createdAt)],
      limit: 8,
    }),
    db
      .select({ count: count() })
      .from(salesOrder)
      .where(eq(salesOrder.attributedAgentUserId, userId)),
    db
      .select({ count: count() })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.attributedAgentUserId, userId),
          ne(salesOrder.afterSalesStatus, "none")
        )
      ),
    db
      .select({ count: count() })
      .from(withdrawalRequest)
      .where(
        and(
          eq(withdrawalRequest.userId, userId),
          eq(withdrawalRequest.status, "pending")
        )
      ),
  ]);

  return {
    profile: profile ?? null,
    balance: balance ?? null,
    referralCodes,
    orders,
    commissionRecords,
    withdrawals,
    summary: {
      attributedOrders: attributedOrdersResult[0]?.count ?? 0,
      refundedOrders: refundedOrdersResult[0]?.count ?? 0,
      pendingWithdrawals: pendingWithdrawalsResult[0]?.count ?? 0,
    },
  };
}

/**
 * 读取管理端分销总览所需的数据
 */
export async function getAdminDistributionOverview() {
  const [
    activeAgentsResult,
    attributedOrdersResult,
    pendingWithdrawalsResult,
    totalCommissionResult,
    availableCommissionResult,
    frozenCommissionResult,
    agentBalances,
    recentOrders,
    recentCommissions,
    recentWithdrawals,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(distributionProfile)
      .where(eq(distributionProfile.status, "active")),
    db
      .select({ count: count() })
      .from(salesOrder)
      .where(isNotNull(salesOrder.attributedAgentUserId)),
    db
      .select({ count: count() })
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.status, "pending")),
    db.select({ total: sum(commissionRecord.amount) }).from(commissionRecord),
    db
      .select({ total: sum(commissionBalance.availableAmount) })
      .from(commissionBalance),
    db
      .select({ total: sum(commissionBalance.frozenAmount) })
      .from(commissionBalance),
    db
      .select({
        profileId: distributionProfile.id,
        userId: distributionProfile.userId,
        displayName: distributionProfile.displayName,
        agentLevel: distributionProfile.agentLevel,
        status: distributionProfile.status,
        depth: distributionProfile.depth,
        boundAt: distributionProfile.boundAt,
        userName: user.name,
        email: user.email,
        availableAmount: commissionBalance.availableAmount,
        frozenAmount: commissionBalance.frozenAmount,
        withdrawnAmount: commissionBalance.withdrawnAmount,
      })
      .from(distributionProfile)
      .leftJoin(user, eq(user.id, distributionProfile.userId))
      .leftJoin(commissionBalance, eq(commissionBalance.userId, distributionProfile.userId))
      .orderBy(desc(distributionProfile.createdAt))
      .limit(8),
    db
      .select({
        id: salesOrder.id,
        userId: salesOrder.userId,
        orderType: salesOrder.orderType,
        status: salesOrder.status,
        afterSalesStatus: salesOrder.afterSalesStatus,
        grossAmount: salesOrder.grossAmount,
        currency: salesOrder.currency,
        referralCode: salesOrder.referralCode,
        attributedAgentUserId: salesOrder.attributedAgentUserId,
        paidAt: salesOrder.paidAt,
        createdAt: salesOrder.createdAt,
        buyerName: user.name,
        buyerEmail: user.email,
      })
      .from(salesOrder)
      .leftJoin(user, eq(user.id, salesOrder.userId))
      .where(isNotNull(salesOrder.attributedAgentUserId))
      .orderBy(desc(salesOrder.paidAt), desc(salesOrder.createdAt))
      .limit(8),
    db
      .select({
        id: commissionRecord.id,
        beneficiaryUserId: commissionRecord.beneficiaryUserId,
        amount: commissionRecord.amount,
        currency: commissionRecord.currency,
        status: commissionRecord.status,
        availableAt: commissionRecord.availableAt,
        createdAt: commissionRecord.createdAt,
        beneficiaryName: user.name,
        beneficiaryEmail: user.email,
      })
      .from(commissionRecord)
      .leftJoin(user, eq(user.id, commissionRecord.beneficiaryUserId))
      .orderBy(desc(commissionRecord.createdAt))
      .limit(8),
    db
      .select({
        id: withdrawalRequest.id,
        userId: withdrawalRequest.userId,
        amount: withdrawalRequest.amount,
        feeAmount: withdrawalRequest.feeAmount,
        netAmount: withdrawalRequest.netAmount,
        currency: withdrawalRequest.currency,
        status: withdrawalRequest.status,
        operatorNote: withdrawalRequest.operatorNote,
        payeeSnapshot: withdrawalRequest.payeeSnapshot,
        createdAt: withdrawalRequest.createdAt,
        reviewedAt: withdrawalRequest.reviewedAt,
        paidAt: withdrawalRequest.paidAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(withdrawalRequest)
      .leftJoin(user, eq(user.id, withdrawalRequest.userId))
      .orderBy(desc(withdrawalRequest.createdAt))
      .limit(10),
  ]);

  return {
    summary: {
      activeAgents: activeAgentsResult[0]?.count ?? 0,
      attributedOrders: attributedOrdersResult[0]?.count ?? 0,
      pendingWithdrawals: pendingWithdrawalsResult[0]?.count ?? 0,
      totalCommission: Number(totalCommissionResult[0]?.total ?? 0),
      availableCommission: Number(availableCommissionResult[0]?.total ?? 0),
      frozenCommission: Number(frozenCommissionResult[0]?.total ?? 0),
    },
    agentBalances,
    recentOrders,
    recentCommissions,
    recentWithdrawals,
  };
}
