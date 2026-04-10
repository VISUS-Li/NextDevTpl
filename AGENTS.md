# AGENTS 规则

## 工作记录

- 每次完成一轮修改后，都要写一段简短总结
- 总结只记录本次改了什么、为什么改、怎么验证的
- 总结要简洁，便于后续快速回忆上下文

## 修改与验证

- 每次代码修改后，必须进行测试或验证
- 只有在验证成功后，才允许进入提交流程
- 如果验证失败，先继续修复，不能跳过验证直接提交

## Git 流程

- 验证成功后再执行 `git add` 和 `git commit`
- 提交完成后再执行 `git push`
- 未经验证的修改不得推送到远端
- 当前机器的 GitHub 凭证文件在 `~/gh-token.txt`
- 如果 HTTPS 推送失败，优先使用该 token 完成 `origin` 推送，不要重复假设本机没有凭证

## 执行原则

- 优先做最小必要修改
- 修改时保持现有代码风格一致
- 每次启动项目时，默认同时启动 Cloudflare 隧道，并使用生成的可访问域名进行访问
- 如果发现阻塞项，先说明原因，再继续处理

## 最近记录

- 2026-04-10：完成 RedInk 模型目录 Phase 5，新增 `redink-phase5-regression` 完整回归链路测试并确认旧 AI Chat 测试未回退，原因是要在收尾前验证目录读取、文本生成、图片任务和结果轮询已经形成可直接使用的闭环；已通过 `pnpm test:run src/test/platform/redink-phase5-regression.test.ts src/test/platform/redink-model-options.test.ts src/test/platform/redink-phase2-proxy.test.ts src/test/platform/redink-phase3-text.test.ts src/test/platform/redink-phase4-image.test.ts src/test/platform/ai-chat.test.ts`、`pnpm exec tsc --noEmit --pretty false` 与 `pnpm exec biome check src/features/ai-gateway/service.ts src/features/redink/request-schema.ts src/features/redink/service.ts src/app/api/platform/redink/model-options/route.ts src/app/api/platform/redink/request-result/route.ts src/app/api/platform/redink/text/route.ts src/app/api/platform/redink/image/route.ts src/test/platform/redink-phase5-regression.test.ts` 验证
- 2026-04-10：完成 RedInk 模型目录 Phase 4，新增 `redink/image` 图片代理与共享消息 schema，原因是商品发布图和通用图片生成需要按管理员目录选模，并且任务型出图要复用 RedInk 自己的轮询接口；已通过 `pnpm test:run src/test/platform/redink-phase4-image.test.ts`、`pnpm exec tsc --noEmit --pretty false` 与 `pnpm exec biome check src/features/redink/request-schema.ts src/features/redink/service.ts src/app/api/platform/redink/image/route.ts src/app/api/platform/redink/request-result/route.ts src/app/api/platform/redink/text/route.ts src/test/platform/redink-phase4-image.test.ts` 验证
- 2026-04-10：完成 RedInk 模型目录 Phase 3，新增 `redink/text` 文本代理并让 AI 网关支持按 `projectKey` 解析工具配置，原因是标题、正文和商品发布文案需要按管理员目录选模且不能被默认项目配置覆盖；已通过 `pnpm test:run src/test/platform/redink-phase3-text.test.ts`、`pnpm exec tsc --noEmit --pretty false` 与 `pnpm exec biome check src/features/ai-gateway/service.ts src/features/redink/service.ts src/app/api/platform/redink/text/route.ts src/test/platform/redink-phase3-text.test.ts` 验证
- 2026-04-10：完成 RedInk 模型目录 Phase 2，新增 `redink/request-result` 代理接口并让 `model-options` 支持 `ETag` 与 `304`，原因是前端需要按 RedInk 命名空间轮询任务结果并缓存模型目录；已通过 `pnpm test:run src/test/platform/redink-phase2-proxy.test.ts`、`pnpm exec tsc --noEmit --pretty false` 与 `pnpm exec biome check src/features/redink/service.ts src/app/api/platform/redink/model-options/route.ts src/app/api/platform/redink/request-result/route.ts src/test/platform/redink-phase2-proxy.test.ts` 验证
- 2026-04-10：完成 RedInk 用户可见模型目录 Phase 1，新增管理员专用 `json4` 模型目录配置、用户态 `model-options` 接口和能力过滤测试，原因是需要让 RedInk 只向用户暴露管理员开放且已在 AI 网关启用的模型子集；已通过 `pnpm test:run src/test/platform/redink-model-options.test.ts`、`pnpm exec tsc --noEmit --pretty false` 与 `pnpm exec biome check src/features/tool-config/service.ts src/app/api/platform/redink/model-options/route.ts src/test/platform/redink-model-options.test.ts` 验证
- 2026-04-09：为 AI 模型绑定新增能力声明并在网关按能力筛选 provider，原因是图片生成、音视频输入输出不能再默认所有模型都支持；已通过 `pnpm test:run src/test/platform/ai-chat.test.ts src/test/platform/ai-chat-multimodal-phase1.test.ts src/test/platform/ai-chat-multimodal-phase2.test.ts src/test/platform/ai-chat-multimodal-phase3.test.ts src/test/platform/ai-admin-management.test.ts src/test/platform/ai-admin-ops.test.ts` 与 `pnpm exec tsc --noEmit --pretty false` 验证
- 2026-04-09：修复极客智坊图片任务轮询路径与状态映射，并为图片输出请求自动补 `image_generation`，原因是 `product-post-image` 创建后需通过 `/chat/{id}` 轮询且 `succeed` 需要视为完成，否则 `redink` 会在轮询阶段失败或只拿到文本说明；已通过 `pnpm test:run src/test/tool-config/ai-client.test.ts src/test/platform/ai-chat-multimodal-phase3.test.ts`、`pnpm exec tsc --noEmit --pretty false` 和真实上游 `/chat/{id}` 查询验证
- 2026-04-09：修复 `redink` 图片生成走 AI 网关时把异步 `pending` 任务误判为空响应的问题，并让后台失败请求回填实际尝试的 provider，原因是 `gemini-2.5-flash` 图片请求会先返回仅含任务元信息的 201 响应且管理台此前显示“未命中”容易误导；已通过 `pnpm test:run src/test/tool-config/ai-client.test.ts`、`pnpm test:run src/test/platform/ai-admin-management.test.ts` 和 `pnpm exec tsc --noEmit --pretty false` 验证
- 2026-04-09：把 AI 资源访问方式接入管理员工具配置，支持按工具切换 `public/proxy`，原因是需要在后台随时切换 OSS 直连和平台代理回源；已通过 `pnpm typecheck` 和 `pnpm exec biome check ...` 验证，`pnpm test:run src/test/platform/storage-phase1-provider.test.ts` 因缺少 `.env.test` 的 `DATABASE_URL` 未能执行
- 2026-04-09：新增管理员对象存储页面，展示运行时存储配置、按工具 AI 资源访问方式、资源记录明细和过期清理入口，原因是后台此前没有集中查看和管理存储能力；已通过 `pnpm typecheck` 与 `pnpm exec biome check ...` 验证
- 2026-04-09：补齐 `.env.test` 以对接本地 PostgreSQL `nextdevtpl`，并完成存储相关平台测试，原因是测试框架只读取 `.env.test`；已通过 `pnpm test:run src/test/platform/storage-*.test.ts`
- 2026-04-09：补齐 storage Phase 4/5 主功能，包括后台生命周期策略、前缀规则、按 requestId/taskId 主动清理和 cron 过期清理，原因是文档剩余功能尚未闭环；已通过 `pnpm typecheck` 与 `pnpm test:run src/test/platform/storage-*.test.ts`
- 2026-04-09：完成 `redink` 真实对象存储链路验收，并更新规划文档，原因是需要确认后台页面、上传、归档和按 requestId 清理在真实环境可用；已通过本地真实接口验收与 `pnpm test:run src/test/platform/storage-*.test.ts`
