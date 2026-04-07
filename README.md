# Trip 开发说明

这个 README 只服务一件事：让后续开发时，先看文档就能知道项目能做什么、入口在哪、改哪里、改完以后 README 也要同步到什么程度。

## 0. 当前改造进度

- 首页 web 端已按 `Trip 旅行者 AI` 方向完成第一版改造
- 首页 mobile 端已按参考稿完成第一版改造
- 当前已落地区域：顶部导航、Hero、工具矩阵、订阅入口、页脚、首页 metadata、移动端底部导航
- 已补给 `RedInk` 使用的 platform API，当前已支持会话读取、积分校验、积分消费、图片上传地址、结果保存
- 已补平台结果查询能力，当前支持结果列表和结果详情读取
- 改造原则：保留现有登录、订阅、文档、语言切换、dashboard 跳转等真实功能，不做纯静态替换
- 当前首页主入口文件：
  - `src/app/[locale]/(marketing)/page.tsx`
  - `src/features/marketing/components/header.tsx`
  - `src/features/marketing/components/hero-section.tsx`
  - `src/features/marketing/components/feature-grid.tsx`
  - `src/features/marketing/components/pricing-section.tsx`
  - `src/features/marketing/components/cta-section.tsx`
  - `src/features/marketing/components/footer.tsx`
- 当前 mobile 端继续复用现有首页、文档、登录、dashboard、订阅流程，没有额外新建静态页面
- 如果后续继续改首页，先以现有项目能力为准，不要把登录、定价、订阅或文档入口改成静态占位

## 1. 当前项目定位

这是一个基于 Next.js App Router 的工具销售官网项目，当前代码已经包含这些主能力：

- 认证：邮箱密码、GitHub OAuth、Google OAuth、会话管理、角色字段
- 订阅与支付：Creem 价格配置、订阅状态、Webhook 入口
- 积分系统：余额、批次、交易、FIFO 过期、充值与消费记录
- 工单系统：用户提交工单、消息往返、管理员处理
- 邮件系统：Resend 发送、React Email 模板、开发环境预览
- 对象存储：S3 / R2 兼容的预签名上传
- 国际化：`en` / `zh`
- 文档与内容：Fumadocs、MDX 文档、博客、法律页
- 监控与基础设施：限流、日志、Sentry、Inngest
- 管理后台：用户、工单、积分与订阅统计
- 官网定位：展示、销售和管理效率工具、AI 工具与数字产品

## 2. 技术栈

| 分类 | 方案 |
|---|---|
| 框架 | Next.js 16, React 19, TypeScript |
| UI | Tailwind CSS 4, Radix UI, 自定义 UI 组件 |
| 数据库 | PostgreSQL, Drizzle ORM |
| 认证 | Better Auth |
| 支付 | Creem |
| 邮件 | Resend, React Email |
| 存储 | AWS S3 / Cloudflare R2 |
| 国际化 | next-intl |
| 内容 | Fumadocs, MDX |
| 后台任务 | Inngest |
| 限流 | Upstash Redis |
| 日志 | Pino, Axiom |
| 监控 | Sentry |
| 代码质量 | Biome, Vitest |

## 3. 本地启动

### 3.1 必要条件

- Node.js 24.x 已验证可用
- pnpm 10.x 已验证可用
- PostgreSQL 16 已验证可用

### 3.2 安装依赖

```bash
pnpm install
```

### 3.3 环境变量

项目使用 `.env.local`。最小启动只需要这 3 项：

```env
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/nextdevtpl
BETTER_AUTH_SECRET=dev-secret-nextdevtpl-local-2026
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

说明：

- 认证、数据库是启动硬依赖
- 支付、邮件、对象存储、Redis、Axiom、Sentry 没配时不会阻塞首页启动
- 开发环境下邮件默认只做控制台预览，不会真实发送
- 当前注册流程不强制邮箱验证，注册后可直接登录

### 3.4 数据库初始化

```bash
pnpm exec drizzle-kit push --force
```

### 3.5 启动开发服务器

```bash
pnpm dev
```

默认地址：

- `http://localhost:3000/zh`
- `http://localhost:3000/en`

## 4. 启动验证结果

本仓库在当前机器上已经完成以下验证：

- `pnpm install` 通过
- `pnpm exec drizzle-kit push --force` 通过
- `pnpm dev` 启动成功
- `GET /zh` 返回 `200`
- `GET /zh/dashboard` 未登录时返回 `307` 并跳转到登录页
- 新用户注册后可直接拿到 session cookie
- 新用户可直接登录并访问 `/zh/dashboard`
- `pnpm typecheck` 通过

## 5. 路由结构

项目以 `src/app/[locale]` 为根，按业务分组：

### 5.1 营销与公开页面

- `/[locale]`：首页
- `/[locale]/blog`
- `/[locale]/blog/[slug]`
- `/[locale]/legal/[slug]`
- `/[locale]/pseo`
- `/[locale]/pseo/[slug]`
- `/[locale]/docs/[...slug]`
- `/[locale]/demo/plan-badges`

对应目录：

- `src/app/[locale]/(marketing)`
- `src/app/[locale]/docs`

### 5.2 认证页面

- `/[locale]/sign-in`
- `/[locale]/sign-up`
- `/[locale]/forgot-password`

对应目录：

- `src/app/[locale]/(auth)`
- `src/features/auth`

### 5.3 用户后台

- `/[locale]/dashboard`
- `/[locale]/dashboard/credits/buy`
- `/[locale]/dashboard/settings`
- `/[locale]/dashboard/support`
- `/[locale]/dashboard/support/new`
- `/[locale]/dashboard/support/[id]`

对应目录：

- `src/app/[locale]/(dashboard)`
- `src/features/dashboard`
- `src/features/credits`
- `src/features/settings`
- `src/features/support`

### 5.4 管理后台

- `/[locale]/admin`
- `/[locale]/admin/users`
- `/[locale]/admin/tickets`
- `/[locale]/admin/tickets/[id]`
- `/[locale]/admin/tool-config`

对应目录：

- `src/app/[locale]/(admin)`
- `src/features/admin`

## 6. 权限与访问控制

当前权限控制分两层：

- `src/middleware.ts`
  - 负责国际化路由
  - 负责 `/dashboard` 未登录跳转
  - 负责敏感 API 的限流
- `src/app/[locale]/(admin)/admin/layout.tsx`
  - 通过 `checkAdmin()` 做管理员权限检查

结论：

- 普通受保护页面先看 `middleware.ts`
- 管理后台权限先看 `src/lib/auth/admin.ts` 和 admin layout

## 7. 目录说明

### 7.1 顶层目录

| 目录 | 作用 |
|---|---|
| `src/app` | App Router 页面与 API 路由 |
| `src/features` | 按业务拆分的模块 |
| `src/components/ui` | 通用 UI 组件 |
| `src/lib` | 基础设施与底层封装 |
| `src/config` | 站点、导航、支付、订阅等静态配置 |
| `src/db` | 数据库连接与 schema |
| `src/content` | 文档、博客、法律文本 |
| `src/i18n` | 国际化配置 |
| `src/test` | Vitest 测试 |
| `drizzle` | Drizzle 生成产物 |
| `docs` | 项目补充说明 |
| `messages` | 多语言文案 |
| `public` | 静态资源 |

### 7.2 功能模块目录

| 目录 | 说明 |
|---|---|
| `src/features/auth` | 登录、注册、忘记密码、认证表单 |
| `src/features/credits` | 积分账户、交易、余额、购买动作 |
| `src/features/payment` | Creem 对接、支付动作、类型 |
| `src/features/subscription` | 用户计划、订阅动作、计划徽章 |
| `src/features/support` | 工单与消息、管理员处理 |
| `src/features/settings` | 个人资料与账单、安全设置 |
| `src/features/storage` | 上传、S3/R2 provider、预签名逻辑 |
| `src/features/mail` | 邮件客户端、模板、发送逻辑 |
| `src/features/admin` | 管理后台侧边栏与后台视图 |
| `src/features/dashboard` | 用户后台布局、卡片、Sidebar |
| `src/features/marketing` | 首页、定价、FAQ、CTA 等公开页面组件 |
| `src/features/blog` | 博客列表和文章卡片 |
| `src/features/pseo` | PSEO 页面数据和组件 |
| `src/features/analytics` | 前端埋点入口 |
| `src/features/shared` | Providers、全局组件、通用图标 |

### 7.3 基础设施目录

| 目录 | 说明 |
|---|---|
| `src/lib/auth` | Better Auth 客户端、服务端和管理员校验 |
| `src/lib/ai` | AI Provider 封装 |
| `src/lib/rate-limit` | 限流策略与响应头 |
| `src/lib/logger` | Pino 日志 |
| `src/lib/monitoring` | Sentry 接入 |
| `src/lib/seo` | SEO 和 JSON-LD |

## 8. 数据与配置入口

后续二开时，优先看这些文件：

| 文件 | 作用 |
|---|---|
| `src/config/site.ts` | 站点名、域名、SEO 基础信息 |
| `src/config/nav.ts` | Header、Footer、Dashboard、Admin 导航 |
| `src/config/payment.ts` | 定价页展示、支付跳转配置、价格 ID |
| `src/config/subscription-plan.ts` | 各订阅计划的权限边界 |
| `src/features/tool-config/service.ts` | 工具配置的默认字段、读写与解析顺序 |
| `src/features/tool-config/schema.ts` | 工具配置接口入参校验 |
| `src/db/schema.ts` | 全部表结构 |
| `src/db/index.ts` | 数据库连接策略 |
| `src/lib/auth/index.ts` | Better Auth 主配置 |
| `src/lib/ai/openai.ts` | AI 客户端创建逻辑，支持工具配置覆盖环境变量 |
| `src/middleware.ts` | i18n、受保护路由、限流白名单 |
| `messages/*` | 国际化文案 |
| `src/content/**/*` | 文档、博客、法律内容 |

### 8.1 Tool Config 当前逻辑

当前仓库已经落地一套项目级工具配置系统，服务 `RedInk`、`Jingfang AI`
这类外部工具。

- 统一入口在 `src/features/tool-config/*`
- 数据表在 `project`、`toolRegistry`、`toolConfigField`、`toolConfigValue`、
  `toolConfigAuditLog`
- 默认项目 key 是 `nextdevtpl`
- 当前默认工具有 `redink`、`jingfang-ai`
- 当前默认字段分两类：
  - 通用 AI 字段：`ai.provider`、`ai.baseUrl`、`ai.apiKey`、`ai.model`
  - 工具专属字段：如 `redink.systemPrompt`、
    `jingfangAi.videoDownloadBaseUrl`、`jingfangAi.analysisPrompt`

配置解析顺序如下：

1. 字段默认值
2. 管理员项目配置
3. 用户个人配置

说明：

- `secret` 类型字段会加密存库
- 加密密钥优先读取 `CONFIG_SECRET_KEY`，未设置时退回
  `BETTER_AUTH_SECRET`
- 工具运行时接口使用 `TOOL_CONFIG_RUNTIME_TOKEN` 保护
- `src/lib/ai/openai.ts` 支持传入 `aiConfig`，传入时优先使用工具配置；
  未传入时继续使用 `.env` 中的 `AI_PROVIDER`、`OPENAI_API_KEY` 等环境变量
- 这意味着当前 AI 配置是“双轨制”：平台工具可走 tool-config，普通业务代码仍可只走环境变量

## 9. API 与后台任务入口

当前关键入口：

- `src/app/api/auth/[...all]/route.ts`：认证 API
- `src/app/api/webhooks/creem/route.ts`：支付回调
- `src/app/api/upload/presigned/route.ts`：文件上传签名
- `src/app/api/platform/session/route.ts`：工具侧读取当前用户、套餐、积分
- `src/app/api/platform/credits/check/route.ts`：工具侧校验积分余额
- `src/app/api/platform/credits/consume/route.ts`：工具侧按次消费积分
- `src/app/api/platform/storage/presigned-image/route.ts`：工具侧申请图片上传地址
- `src/app/api/platform/results/save/route.ts`：工具侧把 JSON 结果写入对象存储
- `src/app/api/platform/results/route.ts`：工具侧读取结果列表
- `src/app/api/platform/results/detail/route.ts`：工具侧读取单条结果详情
- `src/app/api/platform/tool-config/editor/route.ts`：工具前端读取当前用户可编辑字段
- `src/app/api/platform/tool-config/user/route.ts`：工具前端保存当前用户配置
- `src/app/api/platform/tool-config/runtime/route.ts`：工具服务端读取最终运行配置
- `src/app/api/platform/tool-config/revision/route.ts`：工具服务端读取配置版本号
- `src/app/api/jobs/credits/expire/route.ts`：积分过期任务
- `src/app/api/inngest/route.ts`：Inngest 入口
- `src/app/api/search/route.ts`：搜索接口
- `src/app/api/image-proxy/[...path]/route.ts`：图片代理

### 9.1 RedInk 平台接口说明

当前 `NextDevTpl` 除了自身 SaaS 页面和后台，也承担 `RedInk` 的平台底座职责。

接口职责如下：

- `GET /api/platform/session`
  - 返回当前登录用户、当前套餐、积分余额
- `POST /api/platform/credits/check`
  - 给工具在调用 AI 前做积分校验
- `POST /api/platform/credits/consume`
  - 给工具在单次 AI 调用成功后记一笔积分消费
- `POST /api/platform/storage/presigned-image`
  - 给工具申请图片上传地址，文件落到平台对象存储
- `POST /api/platform/results/save`
  - 给工具把生成结果保存为 JSON，目前 `RedInk` 的商品文案结果会写到 `redink/results/<userId>/`
- `GET /api/platform/results`
  - 给工具读取当前用户自己的结果列表
- `GET /api/platform/results/detail`
  - 给工具按 key 读取单条结果详情
- `GET /api/platform/tool-config/editor`
  - 给工具自己的前端页面读取当前用户可见、可编辑的配置字段
- `POST /api/platform/tool-config/user`
  - 给工具自己的前端页面保存当前用户配置
- `POST /api/platform/tool-config/runtime`
  - 给工具自己的服务端读取某个用户在某个工具下的最终运行配置
- `GET /api/platform/tool-config/revision`
  - 给工具自己的服务端轮询配置版本号，判断缓存是否过期

当前分工：

- `NextDevTpl` 负责登录、积分、存储、结果落盘
- `RedInk` 负责图片理解、文案生成和工具交互流程

## 10. 测试与检查

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test:run
```

当前至少应保证：

- 类型检查通过
- 改动涉及的主路径可手动访问
- 涉及 schema 改动时，数据库能正常 `push`
- platform API 改动后，至少跑 `src/test/platform/api.test.ts` 与 `src/test/platform/result-save.test.ts`
- 结果查询改动后，补跑 `src/test/platform/result-query.test.ts`

## 11. 后续开发建议

如果你准备二开，这个顺序最省力：

1. 先改 `src/config/site.ts`、`src/config/nav.ts`，把品牌、导航、外链换掉
2. 再改 `messages` 和 `src/content`，统一文案与内容
3. 再处理支付、邮件、对象存储这类外部服务配置
4. 最后再做业务级扩展，比如新的 dashboard 页面、积分规则、工单流程

## 12. README 维护约定

从现在开始，这个 README 视为开发基线文档。每次后续开发完成后，都要同步更新 README，至少检查这几部分是否需要变更：

- 功能模块是否新增、删除或改名
- 路由是否新增、删除或改权限
- 目录结构是否调整
- 环境变量是否增加或失效
- 关键配置入口是否变化
- 启动和验证步骤是否变化

如果改动影响多个模块，不要只补一句“新增了某功能”，要把入口文件、路由位置、配置位置一起补全。后续开发默认先读这个 README，再动代码。
