FROM node:24-bookworm-slim AS base

# 统一启用 pnpm，避免容器内外命令不一致。
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建阶段补最小环境，避免 Next 在编译时因缺少变量直接退出。
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/tripstack
ENV BETTER_AUTH_SECRET=build-secret-nextdevtpl
ENV BETTER_AUTH_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV REDINK_PUBLIC_URL=http://localhost:12398
ENV OPENAI_API_KEY=docker-placeholder-key
ENV STORAGE_PROVIDER=local

RUN pnpm build

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY . .
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000), { redirect: 'manual' }).then((response) => { if (![200, 307, 308].includes(response.status)) process.exit(1); }).catch(() => process.exit(1))"

CMD ["sh", "-c", "pnpm exec drizzle-kit push --force && pnpm start -H 0.0.0.0 -p ${PORT:-3000}"]
