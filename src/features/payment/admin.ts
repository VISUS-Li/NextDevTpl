import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  paymentIntent,
  type SalesOrderProvider,
  salesAfterSalesEvent,
  salesOrder,
  salesOrderItem,
  subscription,
  user,
} from "@/db/schema";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export type AdminPaymentQueryParams = {
  page?: number;
  pageSize?: number;
  query?: string;
  provider?: SalesOrderProvider | "all";
  orderType?: "subscription" | "credit_purchase" | "all";
  paymentState?:
    | "all"
    | "paid"
    | "confirmed"
    | "closed"
    | "partial_refund"
    | "refunded";
};

/**
 * 支付列表项。
 */
export type AdminPaymentListItem = {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  provider: SalesOrderProvider;
  orderType: "subscription" | "credit_purchase";
  status: "pending" | "paid" | "confirmed" | "closed";
  afterSalesStatus:
    | "none"
    | "partial_refund"
    | "refunded"
    | "returned"
    | "chargeback";
  grossAmount: number;
  currency: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
  eventType: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 支付详情。
 */
export type AdminPaymentDetail = {
  order: AdminPaymentListItem;
  items: Array<typeof salesOrderItem.$inferSelect>;
  paymentIntent: typeof paymentIntent.$inferSelect | null;
  afterSalesEvents: Array<typeof salesAfterSalesEvent.$inferSelect>;
  subscription: typeof subscription.$inferSelect | null;
};

/**
 * 管理端支付列表查询。
 */
export async function listAdminPayments(params: AdminPaymentQueryParams = {}) {
  const page = normalizePositiveInt(params.page, 1);
  const pageSize = Math.min(
    normalizePositiveInt(params.pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const provider = params.provider ?? "all";
  const orderType = params.orderType ?? "all";
  const paymentState = params.paymentState ?? "all";
  const query = params.query?.trim() ?? "";

  const filters = [
    provider === "all" ? undefined : eq(salesOrder.provider, provider),
    orderType === "all" ? undefined : eq(salesOrder.orderType, orderType),
    buildPaymentStateFilter(paymentState),
    buildSearchFilter(query),
  ].filter(Boolean);

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: salesOrder.id,
        userId: salesOrder.userId,
        userName: user.name,
        userEmail: user.email,
        provider: salesOrder.provider,
        orderType: salesOrder.orderType,
        status: salesOrder.status,
        afterSalesStatus: salesOrder.afterSalesStatus,
        grossAmount: salesOrder.grossAmount,
        currency: salesOrder.currency,
        providerOrderId: salesOrder.providerOrderId,
        providerPaymentId: salesOrder.providerPaymentId,
        providerSubscriptionId: salesOrder.providerSubscriptionId,
        eventType: salesOrder.eventType,
        paidAt: salesOrder.paidAt,
        createdAt: salesOrder.createdAt,
        updatedAt: salesOrder.updatedAt,
      })
      .from(salesOrder)
      .innerJoin(user, eq(user.id, salesOrder.userId))
      .where(where)
      .orderBy(desc(salesOrder.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(salesOrder)
      .innerJoin(user, eq(user.id, salesOrder.userId))
      .where(where),
  ]);

  const total = totalResult[0]?.count ?? 0;

  return {
    items: rows satisfies AdminPaymentListItem[],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    filters: {
      query,
      provider,
      orderType,
      paymentState,
    },
  };
}

/**
 * 管理端支付详情查询。
 */
export async function getAdminPaymentDetail(orderId: string) {
  const [orderRow] = await db
    .select({
      id: salesOrder.id,
      userId: salesOrder.userId,
      userName: user.name,
      userEmail: user.email,
      provider: salesOrder.provider,
      orderType: salesOrder.orderType,
      status: salesOrder.status,
      afterSalesStatus: salesOrder.afterSalesStatus,
      grossAmount: salesOrder.grossAmount,
      currency: salesOrder.currency,
      providerOrderId: salesOrder.providerOrderId,
      providerPaymentId: salesOrder.providerPaymentId,
      providerSubscriptionId: salesOrder.providerSubscriptionId,
      eventType: salesOrder.eventType,
      paidAt: salesOrder.paidAt,
      createdAt: salesOrder.createdAt,
      updatedAt: salesOrder.updatedAt,
      metadata: salesOrder.metadata,
    })
    .from(salesOrder)
    .innerJoin(user, eq(user.id, salesOrder.userId))
    .where(eq(salesOrder.id, orderId))
    .limit(1);

  if (!orderRow) {
    return null;
  }

  const paymentIntentId = readStringMetadata(
    orderRow.metadata,
    "paymentIntentId"
  );
  const providerSubscriptionId = orderRow.providerSubscriptionId;
  const [items, afterSalesEvents, currentIntent, currentSubscription] =
    await Promise.all([
      db
        .select()
        .from(salesOrderItem)
        .where(eq(salesOrderItem.orderId, orderId))
        .orderBy(desc(salesOrderItem.createdAt)),
      db
        .select()
        .from(salesAfterSalesEvent)
        .where(eq(salesAfterSalesEvent.orderId, orderId))
        .orderBy(desc(salesAfterSalesEvent.createdAt)),
      paymentIntentId
        ? db
            .select()
            .from(paymentIntent)
            .where(eq(paymentIntent.id, paymentIntentId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      providerSubscriptionId
        ? db
            .select()
            .from(subscription)
            .where(eq(subscription.subscriptionId, providerSubscriptionId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

  return {
    order: {
      id: orderRow.id,
      userId: orderRow.userId,
      userName: orderRow.userName,
      userEmail: orderRow.userEmail,
      provider: orderRow.provider,
      orderType: orderRow.orderType,
      status: orderRow.status,
      afterSalesStatus: orderRow.afterSalesStatus,
      grossAmount: orderRow.grossAmount,
      currency: orderRow.currency,
      providerOrderId: orderRow.providerOrderId,
      providerPaymentId: orderRow.providerPaymentId,
      providerSubscriptionId: orderRow.providerSubscriptionId,
      eventType: orderRow.eventType,
      paidAt: orderRow.paidAt,
      createdAt: orderRow.createdAt,
      updatedAt: orderRow.updatedAt,
    },
    items,
    paymentIntent: currentIntent,
    afterSalesEvents,
    subscription: currentSubscription,
  } satisfies AdminPaymentDetail;
}

/**
 * 管理端页面数据。
 */
export async function getAdminPaymentPageData(
  params: AdminPaymentQueryParams & { orderId?: string }
) {
  const [list, detail] = await Promise.all([
    listAdminPayments(params),
    params.orderId
      ? getAdminPaymentDetail(params.orderId)
      : Promise.resolve(null),
  ]);

  return {
    list,
    detail,
  };
}

function normalizePositiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return fallback;
  }
  return Math.floor(value ?? fallback);
}

function buildPaymentStateFilter(
  paymentState: AdminPaymentQueryParams["paymentState"]
) {
  switch (paymentState) {
    case "paid":
      return and(
        eq(salesOrder.status, "paid"),
        eq(salesOrder.afterSalesStatus, "none")
      );
    case "confirmed":
      return eq(salesOrder.status, "confirmed");
    case "closed":
      return and(
        eq(salesOrder.status, "closed"),
        inArray(salesOrder.afterSalesStatus, ["none", "returned", "chargeback"])
      );
    case "partial_refund":
      return eq(salesOrder.afterSalesStatus, "partial_refund");
    case "refunded":
      return eq(salesOrder.afterSalesStatus, "refunded");
    default:
      return undefined;
  }
}

function buildSearchFilter(query: string) {
  if (!query) {
    return undefined;
  }

  const keyword = `%${query}%`;
  return or(
    ilike(user.email, keyword),
    ilike(user.name, keyword),
    ilike(salesOrder.id, keyword),
    ilike(sql<string>`coalesce(${salesOrder.providerOrderId}, '')`, keyword),
    ilike(sql<string>`coalesce(${salesOrder.providerPaymentId}, '')`, keyword),
    ilike(
      sql<string>`coalesce(${salesOrder.providerSubscriptionId}, '')`,
      keyword
    )
  );
}

function readStringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : null;
}
