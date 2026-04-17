import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  toolLaunchTicket,
  toolRegistry,
  toolRuntimeToken,
  user,
} from "@/db/schema";
import { DEFAULT_PROJECT_KEY, seedDefaultToolConfigProject } from "./service";

export const TOOL_RUNTIME_SCOPES = [
  "runtime:read",
  "runtime:write",
  "session:exchange",
] as const;

export type ToolRuntimeScope = (typeof TOOL_RUNTIME_SCOPES)[number];

/**
 * 创建工具运行时令牌。
 */
export async function createToolRuntimeToken(params: {
  projectKey?: string;
  toolKey: string;
  name: string;
  token: string;
  scopes: ToolRuntimeScope[];
  expiresAt?: Date | null;
}) {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: params.projectKey ?? DEFAULT_PROJECT_KEY,
  });
  const now = new Date();

  await db
    .insert(toolRuntimeToken)
    .values({
      id: crypto.randomUUID(),
      projectId: currentProject.id,
      toolKey: params.toolKey,
      name: params.name,
      tokenHash: hashRuntimeSecret(params.token),
      scopes: params.scopes,
      expiresAt: params.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        toolRuntimeToken.projectId,
        toolRuntimeToken.toolKey,
        toolRuntimeToken.name,
      ],
      set: {
        tokenHash: hashRuntimeSecret(params.token),
        scopes: params.scopes,
        expiresAt: params.expiresAt ?? null,
        enabled: true,
        updatedAt: now,
      },
    });
}

/**
 * 校验工具运行时令牌。
 */
export async function verifyToolRuntimeToken(params: {
  projectKey?: string;
  toolKey: string;
  token: string;
  scope: ToolRuntimeScope;
}) {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: params.projectKey ?? DEFAULT_PROJECT_KEY,
  });
  const [runtimeToken] = await db
    .select()
    .from(toolRuntimeToken)
    .where(
      and(
        eq(toolRuntimeToken.projectId, currentProject.id),
        eq(toolRuntimeToken.toolKey, params.toolKey),
        eq(toolRuntimeToken.tokenHash, hashRuntimeSecret(params.token)),
        eq(toolRuntimeToken.enabled, true),
        or(
          isNull(toolRuntimeToken.expiresAt),
          gt(toolRuntimeToken.expiresAt, new Date())
        )
      )
    )
    .limit(1);

  if (!runtimeToken || !runtimeToken.scopes.includes(params.scope)) {
    return null;
  }

  await db
    .update(toolRuntimeToken)
    .set({
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(toolRuntimeToken.id, runtimeToken.id));

  return runtimeToken;
}

/**
 * 生成一次性工具启动票据。
 */
export async function createToolLaunchTicket(params: {
  projectKey?: string;
  toolKey: string;
  userId: string;
  ttlMinutes?: number;
}) {
  const projectKey = params.projectKey ?? DEFAULT_PROJECT_KEY;
  const currentProject = await seedDefaultToolConfigProject({ projectKey });
  const [tool] = await db
    .select({
      metadata: toolRegistry.metadata,
    })
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        eq(toolRegistry.toolKey, params.toolKey),
        eq(toolRegistry.enabled, true)
      )
    )
    .limit(1);

  if (!tool) {
    throw new Error("工具不存在或未启用");
  }

  const ticket = randomBytes(24).toString("hex");
  const expiresAt = new Date(
    Date.now() + (params.ttlMinutes ?? 10) * 60 * 1000
  );
  const entryUrl =
    typeof tool.metadata?.entry === "object" &&
    tool.metadata.entry &&
    typeof (tool.metadata.entry as Record<string, unknown>).url === "string"
      ? String((tool.metadata.entry as Record<string, unknown>).url)
      : "";
  const launchUrl = buildLaunchUrl(entryUrl, ticket);

  await db.insert(toolLaunchTicket).values({
    id: crypto.randomUUID(),
    projectId: currentProject.id,
    toolKey: params.toolKey,
    userId: params.userId,
    ticketHash: hashRuntimeSecret(ticket),
    expiresAt,
  });

  return {
    projectKey,
    toolKey: params.toolKey,
    ticket,
    expiresAt,
    launchUrl,
  };
}

/**
 * 交换工具启动票据。
 */
export async function exchangeToolLaunchTicket(params: {
  projectKey?: string;
  toolKey: string;
  ticket: string;
}) {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: params.projectKey ?? DEFAULT_PROJECT_KEY,
  });
  const [ticketRow] = await db
    .select({
      id: toolLaunchTicket.id,
      toolKey: toolLaunchTicket.toolKey,
      expiresAt: toolLaunchTicket.expiresAt,
      usedAt: toolLaunchTicket.usedAt,
      userId: toolLaunchTicket.userId,
      userEmail: user.email,
      userName: user.name,
    })
    .from(toolLaunchTicket)
    .innerJoin(user, eq(user.id, toolLaunchTicket.userId))
    .where(
      and(
        eq(toolLaunchTicket.projectId, currentProject.id),
        eq(toolLaunchTicket.toolKey, params.toolKey),
        eq(toolLaunchTicket.ticketHash, hashRuntimeSecret(params.ticket))
      )
    )
    .limit(1);

  if (!ticketRow) {
    return null;
  }
  if (ticketRow.usedAt || ticketRow.expiresAt <= new Date()) {
    return null;
  }

  await db
    .update(toolLaunchTicket)
    .set({
      usedAt: new Date(),
    })
    .where(eq(toolLaunchTicket.id, ticketRow.id));

  return {
    toolKey: ticketRow.toolKey,
    user: {
      id: ticketRow.userId,
      email: ticketRow.userEmail,
      name: ticketRow.userName,
    },
    expiresAt: ticketRow.expiresAt,
  };
}

/**
 * 从请求头中提取 Bearer token。
 */
export function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function hashRuntimeSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildLaunchUrl(entryUrl: string, ticket: string) {
  if (!entryUrl) {
    return `?ticket=${ticket}`;
  }
  const separator = entryUrl.includes("?") ? "&" : "?";
  return `${entryUrl}${separator}ticket=${ticket}`;
}
