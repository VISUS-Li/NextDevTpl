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

interface DistributionGraphOrder {
  id: string;
  orderType: "subscription" | "credit_purchase";
  grossAmount: number;
  currency: string;
  referralCode: string | null;
  afterSalesStatus: "none" | "partial_refund" | "refunded" | "returned" | "chargeback";
  buyerName: string | null;
  buyerEmail: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

interface DistributionGraphNode {
  profileId: string;
  userId: string;
  displayName: string | null;
  userName: string | null;
  email: string | null;
  agentLevel: string | null;
  status: "active" | "inactive";
  depth: number;
  path: string | null;
  inviterUserId: string | null;
  balance: {
    currency: string | null;
    totalEarned: number;
    availableAmount: number;
    frozenAmount: number;
    withdrawnAmount: number;
  };
  stats: {
    directChildren: number;
    totalDescendants: number;
    attributedOrders: number;
    subscriptionOrders: number;
    creditOrders: number;
    grossSales: number;
  };
  recentOrders: DistributionGraphOrder[];
  children: DistributionGraphNode[];
}

/**
 * 构建管理端分销关系图
 */
function buildDistributionGraph(params: {
  profiles: Array<{
    profileId: string;
    userId: string;
    displayName: string | null;
    agentLevel: string | null;
    status: "active" | "inactive";
    depth: number;
    inviterUserId: string | null;
    path: string | null;
    userName: string | null;
    email: string | null;
    currency: string | null;
    totalEarned: number | null;
    availableAmount: number | null;
    frozenAmount: number | null;
    withdrawnAmount: number | null;
  }>;
  orders: Array<{
    id: string;
    orderType: "subscription" | "credit_purchase";
    grossAmount: number;
    currency: string;
    referralCode: string | null;
    attributedAgentUserId: string | null;
    afterSalesStatus: "none" | "partial_refund" | "refunded" | "returned" | "chargeback";
    paidAt: Date | null;
    createdAt: Date;
    buyerName: string | null;
    buyerEmail: string | null;
  }>;
}) {
  const ordersByAgent = new Map<string, DistributionGraphOrder[]>();

  for (const order of params.orders) {
    if (!order.attributedAgentUserId) {
      continue;
    }

    const list = ordersByAgent.get(order.attributedAgentUserId) ?? [];
    list.push({
      id: order.id,
      orderType: order.orderType,
      grossAmount: order.grossAmount,
      currency: order.currency,
      referralCode: order.referralCode,
      afterSalesStatus: order.afterSalesStatus,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    });
    ordersByAgent.set(order.attributedAgentUserId, list);
  }

  for (const list of ordersByAgent.values()) {
    list.sort(
      (left, right) =>
        (right.paidAt ?? right.createdAt).getTime() -
        (left.paidAt ?? left.createdAt).getTime()
    );
  }

  const profileByUserId = new Map(
    params.profiles.map((profile) => [profile.userId, profile] as const)
  );
  const childrenByInviter = new Map<string, string[]>();

  for (const profile of params.profiles) {
    if (!profile.inviterUserId) {
      continue;
    }
    const list = childrenByInviter.get(profile.inviterUserId) ?? [];
    list.push(profile.userId);
    childrenByInviter.set(profile.inviterUserId, list);
  }

  /**
   * 递归生成单个代理节点
   */
  function buildNode(userId: string): DistributionGraphNode | null {
    const profile = profileByUserId.get(userId);
    if (!profile) {
      return null;
    }

    const children = (childrenByInviter.get(userId) ?? [])
      .map((childUserId) => buildNode(childUserId))
      .filter((node): node is DistributionGraphNode => Boolean(node));
    const orders = ordersByAgent.get(userId) ?? [];

    return {
      profileId: profile.profileId,
      userId: profile.userId,
      displayName: profile.displayName,
      userName: profile.userName,
      email: profile.email,
      agentLevel: profile.agentLevel,
      status: profile.status,
      depth: profile.depth,
      path: profile.path,
      inviterUserId: profile.inviterUserId,
      balance: {
        currency: profile.currency,
        totalEarned: profile.totalEarned ?? 0,
        availableAmount: profile.availableAmount ?? 0,
        frozenAmount: profile.frozenAmount ?? 0,
        withdrawnAmount: profile.withdrawnAmount ?? 0,
      },
      stats: {
        directChildren: children.length,
        totalDescendants: children.reduce(
          (sum, child) => sum + child.stats.totalDescendants + 1,
          0
        ),
        attributedOrders: orders.length,
        subscriptionOrders: orders.filter((order) => order.orderType === "subscription").length,
        creditOrders: orders.filter((order) => order.orderType === "credit_purchase").length,
        grossSales: orders.reduce((sum, order) => sum + order.grossAmount, 0),
      },
      recentOrders: orders.slice(0, 3),
      children,
    };
  }

  return params.profiles
    .filter(
      (profile) =>
        !profile.inviterUserId || !profileByUserId.has(profile.inviterUserId)
    )
    .sort((left, right) => left.depth - right.depth)
    .map((profile) => buildNode(profile.userId))
    .filter((node): node is DistributionGraphNode => Boolean(node));
}

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
    graphProfiles,
    graphOrders,
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
    db
      .select({
        profileId: distributionProfile.id,
        userId: distributionProfile.userId,
        displayName: distributionProfile.displayName,
        agentLevel: distributionProfile.agentLevel,
        status: distributionProfile.status,
        depth: distributionProfile.depth,
        inviterUserId: distributionProfile.inviterUserId,
        path: distributionProfile.path,
        userName: user.name,
        email: user.email,
        currency: commissionBalance.currency,
        totalEarned: commissionBalance.totalEarned,
        availableAmount: commissionBalance.availableAmount,
        frozenAmount: commissionBalance.frozenAmount,
        withdrawnAmount: commissionBalance.withdrawnAmount,
      })
      .from(distributionProfile)
      .leftJoin(user, eq(user.id, distributionProfile.userId))
      .leftJoin(commissionBalance, eq(commissionBalance.userId, distributionProfile.userId))
      .orderBy(distributionProfile.depth, desc(distributionProfile.createdAt)),
    db
      .select({
        id: salesOrder.id,
        orderType: salesOrder.orderType,
        grossAmount: salesOrder.grossAmount,
        currency: salesOrder.currency,
        referralCode: salesOrder.referralCode,
        attributedAgentUserId: salesOrder.attributedAgentUserId,
        afterSalesStatus: salesOrder.afterSalesStatus,
        paidAt: salesOrder.paidAt,
        createdAt: salesOrder.createdAt,
        buyerName: user.name,
        buyerEmail: user.email,
      })
      .from(salesOrder)
      .leftJoin(user, eq(user.id, salesOrder.userId))
      .where(isNotNull(salesOrder.attributedAgentUserId))
      .orderBy(desc(salesOrder.paidAt), desc(salesOrder.createdAt)),
  ]);

  const graph = buildDistributionGraph({
    profiles: graphProfiles,
    orders: graphOrders,
  });

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
    graph,
  };
}
