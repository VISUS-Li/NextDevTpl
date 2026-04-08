import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { aiRequestAttempt, aiRequestLog, aiRelayProvider } from "@/db/schema";

/**
 * 读取 AI 网关总览数据。
 */
export async function getAIGatewayOverview() {
  const [overview] = await db
    .select({
      totalRequests: sql<number>`count(*)`,
      successRequests:
        sql<number>`count(*) filter (where ${aiRequestLog.status} = 'success')`,
      failedRequests:
        sql<number>`count(*) filter (where ${aiRequestLog.status} = 'failed')`,
      insufficientCredits:
        sql<number>`count(*) filter (where ${aiRequestLog.status} = 'insufficient_credits')`,
      totalProviderCostMicros:
        sql<number>`coalesce(sum(${aiRequestLog.providerCostUsd}), 0)`,
      totalChargedCredits:
        sql<number>`coalesce(sum(${aiRequestLog.chargedCredits}), 0)`,
    })
    .from(aiRequestLog);

  return {
    totalRequests: Number(overview?.totalRequests ?? 0),
    successRequests: Number(overview?.successRequests ?? 0),
    failedRequests: Number(overview?.failedRequests ?? 0),
    insufficientCredits: Number(overview?.insufficientCredits ?? 0),
    totalProviderCostMicros: Number(overview?.totalProviderCostMicros ?? 0),
    totalChargedCredits: Number(overview?.totalChargedCredits ?? 0),
  };
}

/**
 * 读取 provider 维度的摘要统计。
 */
export async function getAIProviderSummary() {
  const rows = await db
    .select({
      providerKey: aiRelayProvider.key,
      providerName: aiRelayProvider.name,
      totalAttempts: sql<number>`count(${aiRequestAttempt.id})`,
      successAttempts:
        sql<number>`count(${aiRequestAttempt.id}) filter (where ${aiRequestAttempt.status} = 'success')`,
      failedAttempts:
        sql<number>`count(${aiRequestAttempt.id}) filter (where ${aiRequestAttempt.status} <> 'success')`,
      averageLatencyMs:
        sql<number>`coalesce(avg(${aiRequestAttempt.latencyMs}), 0)`,
      totalProviderCostMicros:
        sql<number>`coalesce(sum(${aiRequestAttempt.providerCostUsd}), 0)`,
      lastHealthStatus: aiRelayProvider.lastHealthStatus,
    })
    .from(aiRelayProvider)
    .leftJoin(aiRequestAttempt, eq(aiRequestAttempt.providerId, aiRelayProvider.id))
    .groupBy(
      aiRelayProvider.id,
      aiRelayProvider.key,
      aiRelayProvider.name,
      aiRelayProvider.lastHealthStatus
    );

  return rows.map((item) => ({
    ...item,
    totalAttempts: Number(item.totalAttempts ?? 0),
    successAttempts: Number(item.successAttempts ?? 0),
    failedAttempts: Number(item.failedAttempts ?? 0),
    averageLatencyMs: Number(item.averageLatencyMs ?? 0),
    totalProviderCostMicros: Number(item.totalProviderCostMicros ?? 0),
  }));
}
