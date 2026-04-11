import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeonWs } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * 数据库连接配置
 *
 * 支持两种模式:
 * 1. Neon Serverless WebSocket (生产/测试环境) - 支持事务，兼容 Node.js 和 Edge Runtime
 * 2. 标准 PostgreSQL (本地开发/Docker) - 使用连接池
 *
 * 注意: Neon 始终使用 WebSocket 模式以支持事务
 * - Node.js 环境: 需要 ws 包提供 WebSocket
 * - Edge Runtime (CF Workers/Vercel Edge): 使用原生 WebSocket API
 */

// 确保环境变量存在
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL 环境变量未设置，请在 .env 文件中配置数据库连接"
  );
}

const databaseUrl = process.env.DATABASE_URL;

/**
 * 检测是否使用 Neon Serverless
 */
const isNeon = databaseUrl.includes("neon.tech");

/**
 * 检测是否在 Node.js 环境
 * Edge Runtime (CF Workers, Vercel Edge) 没有 process.versions.node
 */
const isNodeJs = typeof process !== "undefined" && process.versions?.node;

type DatabaseInstance = ReturnType<typeof createDatabaseConnection>;

type GlobalDatabaseCache = {
  db?: DatabaseInstance;
  pgPool?: Pool;
  neonPool?: NeonPool;
};

const globalDatabase = globalThis as typeof globalThis & {
  __nextDevTplDbCache?: GlobalDatabaseCache;
};

/**
 * 创建数据库实例
 * - Neon: 使用 WebSocket 连接 (支持事务，兼容 Node.js 和 Edge)
 * - 标准 PG: 使用连接池 (本地开发/Docker)
 */
function createDatabaseConnection() {
  if (isNeon) {
    // 开发环境热更新时复用同一个连接池，避免重复建连。
    const cachedNeonPool = globalDatabase.__nextDevTplDbCache?.neonPool;

    // Node.js 环境需要手动设置 WebSocket 构造函数
    // Edge Runtime (CF Workers, Vercel Edge) 有原生 WebSocket，无需设置
    if (isNodeJs) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ws = require("ws");
      neonConfig.webSocketConstructor = ws;
    }

    // 使用 WebSocket 连接池，支持事务
    const pool =
      cachedNeonPool ??
      new NeonPool({
        connectionString: databaseUrl,
        max: 10,
        idleTimeoutMillis: 30_000,
      });
    globalDatabase.__nextDevTplDbCache = {
      ...globalDatabase.__nextDevTplDbCache,
      neonPool: pool,
    };
    return drizzleNeonWs(pool, { schema });
  }

  // 开发环境热更新时复用同一个 pg 连接池，避免连接数不断上涨。
  const cachedPgPool = globalDatabase.__nextDevTplDbCache?.pgPool;

  // 标准 PostgreSQL 连接池 (本地开发/Docker)
  const pool =
    cachedPgPool ??
    new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
  globalDatabase.__nextDevTplDbCache = {
    ...globalDatabase.__nextDevTplDbCache,
    pgPool: pool,
  };
  return drizzlePg(pool, { schema });
}

/**
 * 获取数据库实例
 *
 * 复用全局单例，避免开发模式热更新时重复创建连接池。
 */
function getDatabaseInstance() {
  const cachedDb = globalDatabase.__nextDevTplDbCache?.db;
  if (cachedDb) {
    return cachedDb;
  }

  const db = createDatabaseConnection();
  globalDatabase.__nextDevTplDbCache = {
    ...globalDatabase.__nextDevTplDbCache,
    db,
  };
  return db;
}

// 导出数据库实例
export const db = getDatabaseInstance();

// 导出 Schema 以便在其他地方使用
export * from "./schema";
