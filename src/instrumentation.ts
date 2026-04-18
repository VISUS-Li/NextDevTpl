/**
 * Next.js Instrumentation Hook
 *
 * 用于在服务器启动时执行初始化逻辑
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
	// 未启用 Sentry 时直接跳过，避免开发环境为无效配置编译整条监控链。
	if (!process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) {
		return;
	}

	// 服务端初始化
	if (process.env.NEXT_RUNTIME === "nodejs") {
		// Sentry 服务端初始化
		await import("../sentry.server.config");
	}

	// Edge Runtime 初始化
	if (process.env.NEXT_RUNTIME === "edge") {
		await import("../sentry.edge.config");
	}
}
