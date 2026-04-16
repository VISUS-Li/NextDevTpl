import { Pool } from "pg";

// 统一解析 PostgreSQL 连接串，避免部署脚本和容器启动各写一套逻辑。
function getDatabaseUrls() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未设置");
  }

  const targetUrl = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(targetUrl.protocol)) {
    return null;
  }

  const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));
  if (!databaseName) {
    throw new Error("DATABASE_URL 缺少数据库名");
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = `/${process.env.POSTGRES_ADMIN_DB || "postgres"}`;
  return {
    adminUrl: adminUrl.toString(),
    databaseName,
  };
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensurePostgresDatabase() {
  const urls = getDatabaseUrls();
  if (!urls) {
    console.log("当前不是 PostgreSQL 连接，跳过自动建库");
    return;
  }

  const pool = new Pool({ connectionString: urls.adminUrl });
  try {
    const result = await pool.query(
      "select 1 from pg_database where datname = $1",
      [urls.databaseName]
    );
    if (result.rowCount) {
      console.log(`数据库已存在: ${urls.databaseName}`);
      return;
    }

    console.log(`准备创建数据库: ${urls.databaseName}`);
    await pool.query(`create database ${quoteIdentifier(urls.databaseName)}`);
  } finally {
    await pool.end();
  }
}

await ensurePostgresDatabase();
