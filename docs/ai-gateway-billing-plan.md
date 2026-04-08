# AI 网关与计费统计方案

## 1. 文档目的

本文档用于给 `NextDevTpl` 设计一套尽量简单、但计费统计准确的 AI 网关方案。

当前目标不是引入一个新的外部 AI 平台来替代现有业务系统，而是：

1. 保留 `NextDevTpl` 现有用户、订阅、积分体系
2. 让 `redink`、`jingfang-ai` 这类工具统一调用 `NextDevTpl`
3. 由 `NextDevTpl` 决定实际走哪个中转站
4. 在 `NextDevTpl` 内统一记录调用、成本、扣费、失败原因和统计数据
5. 后续如果上游中转站变多，仍然可以用同一套账本与后台管理

结论先写在前面：

- 主方案使用 `NextDevTpl` 自己做统一 AI 网关、统一账本、统一计费
- 不直接接入 `one-api`、`new-api` 作为主计费中心
- 可以参考 `LiteLLM`、`OpenMeter`、`Helicone`、`one-api` 的部分设计，但不照搬它们的用户和充值体系
- 上游中转站例如 GeekAI、云雾，只作为 `NextDevTpl` 的“上游渠道”，不作为业务主账本

## 当前进度

### 已完成

- Phase 0：命名、分层和数据口径已固定到本文档
- Phase 1 后端闭环已完成：
  - 已新增 AI 网关核心表结构
  - 已新增统一接口 `POST /api/platform/ai/chat`
  - 已新增 `src/features/ai-gateway/service.ts`
  - 已改造 `src/lib/ai/openai.ts`，支持返回 usage
  - 已完成接口级测试，覆盖成功扣费和余额不足两条主链路
  - 已将最新 schema 推送到本地开发数据库
- Phase 2 后端回退链路已完成：
  - 已支持多个 provider 的优先级路由
  - 已支持 `priority_failover`
  - 已新增 `ai_request_attempt` 明细记录
  - 已完成接口级测试，覆盖主中转站失败后自动回退到备份中转站
- Phase 3 后端计费能力已完成：
  - 已支持 `fixed_credits`
  - 已支持 `token_based`
  - 已支持平台侧 provider 成本计算
  - 已新增 `ai_billing_record`
  - 已完成接口级测试，覆盖 token 计费与 AI 请求到积分账本的关联
  - 当前已验证“平台成本”和“用户扣费”是两套独立口径
- Phase 4 最小流式能力已完成：
  - `POST /api/platform/ai/chat` 已支持 `stream=true`
  - 当前返回标准 `text/event-stream`
  - 当前阶段为平台侧 SSE 输出，不是上游实时 token 透传
  - 已完成接口级测试，覆盖流式响应协议
- Phase 4 管理闭环已完成：
  - 已新增后台入口 `/admin/ai`
  - 已新增管理员接口：
    - `GET/POST /api/platform/ai/admin/providers`
    - `PATCH/DELETE /api/platform/ai/admin/providers/:id`
    - `GET/POST /api/platform/ai/admin/model-bindings`
    - `PATCH/DELETE /api/platform/ai/admin/model-bindings/:id`
    - `GET/POST /api/platform/ai/admin/pricing-rules`
    - `PATCH/DELETE /api/platform/ai/admin/pricing-rules/:id`
    - `GET /api/platform/ai/admin/requests`
  - 已完成接口级测试，覆盖“管理员建配置 -> 普通用户请求 -> 管理员查明细”链路
- Phase 5 最小运营能力已完成：
  - 已新增 `GET /api/platform/ai/summary`
  - 已提供总览统计与 provider 摘要
  - 已完成独立测试文件，覆盖“普通用户调用 -> 管理员查看汇总”链路
- Phase 5 运维闭环已完成：
  - 已新增管理员运维接口：
    - `POST /api/platform/ai/admin/providers/health-check`
    - `POST /api/platform/ai/admin/billing-adjustments`
    - `GET /api/platform/ai/admin/alerts`
  - 已支持管理员手工调账，生成独立 `ai_billing_record`
  - 已支持 provider 健康检查并可按失败结果自动下线
  - 已支持基础运维告警：
    - provider 下线告警
    - 高失败率告警
    - 高成本请求告警
  - 已完成接口级测试，覆盖“普通用户请求 -> 管理员退款 -> 健康检查下线 -> 告警查询”链路
- Phase 6 多模态阶段 1 已完成：
  - `POST /api/platform/ai/chat` 已支持文本 + 图片输入
  - `messages[].content` 已支持字符串和 part 数组两种形式
  - 已支持平台受控图片资产输入 `image_asset`
  - 已支持 `input` 作为 `messages` 的兼容别名，便于后续接 `responses` 风格
  - 已在 API 返回中补充 `output` 字段和更细的 usage 明细字段
  - 已新增独立测试文件 `src/test/platform/ai-chat-multimodal-phase1.test.ts`
  - 已通过接口级测试，覆盖图片 URL 输入和平台资产输入两条链路

### 当前状态

- 基础 AI 网关、计费、运维和管理闭环已经全部落成
- 多模态改造已完成第 1 阶段，当前可直接用于“文本 + 图片输入，文本输出”场景
- 下一阶段应继续补齐音频输入 / 输出与更细 usage 结构
- 多模态能力仍应优先在现有 AI 网关和账本结构上迭代，而不是重起一套新系统

### 最终完成说明

当前项目已具备以下完整闭环：

1. 工具统一调用 `POST /api/platform/ai/chat`
2. 平台按 `toolKey / featureKey / model / provider` 记录请求、尝试、结算
3. 平台支持多中转站路由、失败回退、成本统计和积分扣费
4. 管理员可维护 provider、model binding、pricing rule
5. 管理员可查看请求明细与汇总
6. 管理员可执行健康检查、手工调账和告警排查

当前剩余工作主要集中在多模态后续阶段，包括音频、视频、任务型输出与结果轮询。

## 2. 当前项目现状

### 2.1 已有能力

当前仓库已经有这些基础：

- 用户和会话：`src/db/schema.ts` 中的 `user`、`session`
- 订阅体系：`src/features/payment/*`
- 积分钱包和记账：`src/features/credits/core.ts`
- 工具配置：`src/features/tool-config/*`
- 工具运行时配置读取：`/api/platform/tool-config/runtime`
- 工具侧统一积分检查和扣费：
  - `/api/platform/credits/check`
  - `/api/platform/credits/consume`
- 通用 AI 客户端封装：`src/lib/ai/openai.ts`

### 2.2 当前缺口

项目当前还没有以下能力：

1. 没有统一 AI 请求入口
2. 没有 AI 使用明细表
3. 没有按工具、功能、模型、上游中转站维度的统计
4. 没有“真实 usage -> 实际扣费”的结算层
5. 没有多中转站的路由策略和健康状态管理
6. 没有独立的 AI 成本账本

也就是说，当前项目已经有“钱包”，但还没有“AI 调用账本”。

## 3. 参考项目中值得借鉴的部分

这里不讨论“整套引入”，只讨论哪些设计值得参考。

### 3.1 one-api / new-api

值得参考的点：

- 上游渠道抽象
- 渠道级别启停
- 模型到渠道的映射
- 渠道倍率、分组、优先级概念
- 用量明细与余额变化分开记录

不建议直接照搬的点：

- 它们自带用户、令牌、充值、额度体系
- 会和 `NextDevTpl` 现有用户、积分、订阅形成双系统
- 你的核心维度是“用户 + 工具 + 功能”，不是“平台用户 + API key”

结论：

- 参考“渠道层”设计
- 不接管业务用户和充值逻辑

参考地址：

- <https://github.com/songquanpeng/one-api>
- <https://github.com/QuantumNous/new-api>

### 3.2 LiteLLM

值得参考的点：

- provider 抽象
- 模型路由和 fallback
- metadata 透传
- spend tracking
- virtual key / project / user 维度的预算概念

对当前方案最有价值的部分：

- 把“上游模型调用”从业务层解耦出来
- 请求打上 metadata，后续便于统计
- 为以后多 provider、模型切换、回退预留结构

结论：

- 当前阶段参考它的抽象思路
- 如果后续上游越来越多，可以把 LiteLLM 放到 `NextDevTpl` 后面做模型网关

参考地址：

- <https://github.com/BerriAI/litellm>
- <https://docs.litellm.ai/>

### 3.3 OpenMeter

值得参考的点：

- usage event 和 billing ledger 分开
- metering 和 pricing rule 分开
- 预付费 credits、额度阈值、entitlement 这些概念很清晰

不建议当前直接引入的原因：

- 体系偏重
- 你现在的数据量和复杂度还没到必须引入独立 metering 平台的程度

结论：

- 参考“事件账本”和“计费规则解耦”的设计
- 当前不直接接入

参考地址：

- <https://github.com/openmeterio/openmeter>

### 3.4 Helicone

值得参考的点：

- 请求级 trace
- latency / cost / model / provider 观测
- 通过 metadata 做请求归因

不建议直接作为主计费的原因：

- 它更偏 observability，不是你的业务主账本
- 它适合辅助分析，不适合接管用户余额和真实扣费

结论：

- 参考“请求观测字段”
- 不接管业务计费

参考地址：

- <https://github.com/Helicone/helicone>

### 3.5 GeekAI / 云雾这类中转站

这类中转站的共同点很明显：

- 基本都提供 OpenAI 兼容接口
- 常见能力是“一个 key 对接多个模型”
- 一般会有自己的分组、倍率、价格、可用性、配额概念
- 往往支持文本、图像、语音、视频等不同类型接口

从官方文档能确认的点：

- GeekAI 明确强调统一接口、统一账号、动态负载均衡、价格/可用性调度，并提供 OpenAI 兼容调用方式
- 云雾明确强调兼容 OpenAI 接口协议、一个 key 全模型通用、API key 可设定时间和额度，并且不同分组会有不同费率倍率

这对 `NextDevTpl` 的含义是：

- 上游并不稳定是“单一官方 OpenAI”
- 上游可能是“聚合平台中的某个分组”
- 同一个模型在不同中转站和不同分组下，实际成本、质量、稳定性都可能不同

结论：

- `NextDevTpl` 必须显式建模“中转站”和“路由规则”
- 不能再假设只有一个 `OPENAI_API_KEY + BASE_URL`

参考地址：

- GeekAI: <https://docs.geekai.co/cn/docs/introduction>
- 云雾: <https://yunwu.apifox.cn/>

### 3.6 多模态接入时可直接借鉴的实现点

这一节不是为了决定“是否引入外部平台”，而是为了给 `NextDevTpl` 自研多模态能力提供边界和参考，避免闭门造车。

核心结论先写明：

- `NextDevTpl` 仍然自己实现统一 AI 网关
- 外部项目只借鉴长处，不接管主账本
- 多模态改造的重点不是“兼容某一家接口”，而是先定义平台内部统一消息结构
- provider 适配、计费、日志、媒体存储要分层，不要糊在一个接口里

#### 3.6.1 one-api / new-api 值得借鉴的点

适合借鉴：

- 渠道抽象
  - 把上游站点、分组、线路显式建模
- 模型映射
  - 区分平台内部模型名和上游真实模型名
- 协议兼容层
  - 同一平台入口兼容 OpenAI、Claude、Gemini 等不同协议
- 请求尺寸限制
  - 对大请求体、流式缓冲做上限保护
- 令牌 / 配额 / 限流
  - 可参考它们对 key、用户、模型的约束维度

不建议照搬：

- 用户体系
- 令牌体系
- 在线充值
- 平台余额和账单页面

原因：

- 这些能力会和 `NextDevTpl` 现有用户、订阅、credits 账本形成双系统
- 你的核心维度是“用户 + 工具 + feature + request”，不是“外部 API key 平台”

对 `NextDevTpl` 的具体启发：

- `provider` 必须支持“站点 + 分组 + 路由策略”建模
- `modelKey` 和 `modelAlias` 必须持续保留
- 多模态请求体必须有限制，不允许任意超大 base64 直接压进业务接口
- 如果后续需要兼容更多协议，应该在 adapter 层做转换，而不是在业务入口直接分叉

#### 3.6.2 LiteLLM 值得借鉴的点

LiteLLM 对你最有价值的不是“替你计费”，而是“统一 provider 适配层”的思路。

适合借鉴：

- 统一 OpenAI 风格输入输出
- `chat`、`responses`、`images`、`audio` 等不同端点的抽象
- metadata 透传
- fallback / retry / routing
- project / user / team 维度的 spend tracking 思路
- 虚拟 key 和预算控制的接口边界

不建议照搬：

- 让 LiteLLM 成为业务主账本
- 让工具直接面向 LiteLLM，而绕过 `NextDevTpl`

对 `NextDevTpl` 的具体启发：

- 你自己的 adapter 层要和业务层解耦
- 统一接口应当允许记录 metadata，并在请求日志里落库
- 内部要为 `chat completions` 与 `responses` 两类风格预留映射空间
- 如果未来 provider 数量明显增加，LiteLLM 很适合作为 `NextDevTpl` 后面的第二层网关

#### 3.6.3 Helicone 值得借鉴的点

适合借鉴：

- 请求级 trace
- 按 user、team、自定义属性做归因
- latency / cost / provider / model 观测
- 自定义 metadata / property 标签

对 `NextDevTpl` 的具体启发：

- 每次请求都应附带并记录：
  - `userId`
  - `toolKey`
  - `featureKey`
  - `requestType`
  - `requestedModel`
  - `resolvedProvider`
  - `resolvedModel`
  - `requestId`
- 这些字段应当是你自己的观测基础字段，而不是依赖某个外部平台

#### 3.6.4 OpenMeter 值得借鉴的点

适合借鉴：

- usage event 和 billing ledger 分离
- quota / entitlement / threshold 概念清晰
- 计量规则和定价规则分开

对 `NextDevTpl` 的具体启发：

- 多模态请求落库时，要区分“事实用量”和“财务结果”
- `usage` 不能只记录 `totalTokens`
- 计费不应和请求执行逻辑写死在一起

#### 3.6.5 BricksLLM 值得借鉴的点

适合借鉴：

- per key / per tenant 的 spend limit
- 成本和速率限制分层
- 生产环境下的 usage ledger 思维

对 `NextDevTpl` 的具体启发：

- 后续如果同一用户在不同工具、feature、模型上的成本差异很大，可以继续加：
  - 用户级预算
  - 工具级预算
  - provider 级熔断
- 这些约束仍应放在 `NextDevTpl` 内，而不是外包给上游平台

#### 3.6.6 GeekAI 这类上游接口值得借鉴的点

GeekAI 的意义在于，它展示了“OpenAI 兼容超集”的现实形态。

从官方接口能确认的有价值信息：

- `chat/completions` 已不只是文本接口
- 支持 `modalities`
  - `text`
  - `image`
  - `audio`
  - `video`
- 响应 usage 里细分了：
  - `text_tokens`
  - `audio_tokens`
  - `image_tokens`
  - `video_tokens`
  - `reasoning_tokens`
  - `billed_units`
- 支持 `tools`、`tool_choice`、`thinking`、`enable_search`、`enable_url_context`
- 提供单次对话账单查询接口，可做上游成本核对

对 `NextDevTpl` 的具体启发：

- 内部 usage 结构必须预留多模态细分字段
- 请求模型不能再只按“文本 chat”建模
- 未来某些能力是“按次计费”而不是按 token 计费
- 即便上游号称 OpenAI 兼容，也往往会存在超出 OpenAI 基线的扩展参数
- 平台不应把这些扩展参数原样暴露给前端，而应在 adapter 层做翻译

#### 3.6.7 面向 `NextDevTpl` 的最终收敛原则

基于上面这些项目，`NextDevTpl` 后续做多模态时，建议收敛成下面这几条硬约束：

1. 统一消息结构

- 内部消息内容不再固定为 `string`
- 改为“消息 + part 列表”模型
- part 至少支持：
  - `text`
  - `image_url`
  - `image_asset`
  - `audio_url`
  - `audio_asset`
  - `video_url`
  - `video_asset`
  - `file_asset`

2. 统一资产入口

- 图片、音频、视频、文件先进入平台存储
- AI 请求里只引用平台资产 ID 或受控 URL
- 不建议把大文件长期以内联 base64 形式直接走业务主接口

3. 统一能力表

- 需要给模型维护能力描述，而不是写死在代码判断里
- 至少记录：
  - 是否支持图片输入
  - 是否支持音频输入
  - 是否支持视频输入
  - 是否支持图片输出
  - 是否支持音频输出
  - 是否支持工具调用
  - 是否支持 JSON schema
  - 是否支持 reasoning
  - 是否支持 streaming

4. 统一 usage 结构

- 平台内部 usage 至少要支持：
  - `promptTokens`
  - `completionTokens`
  - `totalTokens`
  - `textInputTokens`
  - `imageInputTokens`
  - `audioInputTokens`
  - `videoInputTokens`
  - `reasoningTokens`
  - `cachedTokens`
  - `billedUnits`

5. 统一 adapter 边界

- 前端和工具侧只调用 `NextDevTpl` 自己的接口
- provider 差异只存在于 adapter 层
- 不允许在业务层直接写 Geek / OpenAI / Gemini / Claude 的协议细节

6. 统一计费分层

- 请求执行成功或失败，是调用层事实
- 上游实际成本，是成本层事实
- 用户 credits 扣减，是业务账本事实
- 三者必须分开记录

#### 3.6.8 推荐的多模态落地顺序

为了避免一次改太多，建议按下面顺序推进：

第一阶段：

- 支持文本输入 + 图片输入
- 输出仍以文本为主
- 保留现有 chat 主链路
- 当前状态：已完成

第二阶段：

- 支持音频输入和音频输出
- 补齐更细 usage 字段
- 支持 `responses` 风格映射
- 当前状态：待开发

第三阶段：

- 支持视频输入
- 支持图片生成 / 视频任务型输出
- 支持异步任务和结果轮询
- 当前状态：待开发

这样实现的好处是：

- 和当前仓库现状最连续
- 风险最小
- 便于逐阶段验证计费、日志和媒体处理是否正确

参考地址：

- one-api: <https://github.com/songquanpeng/one-api>
- new-api: <https://github.com/QuantumNous/new-api>
- LiteLLM: <https://github.com/BerriAI/litellm>
- LiteLLM Docs: <https://docs.litellm.ai/>
- OpenMeter: <https://github.com/openmeterio/openmeter>
- Helicone AI Gateway: <https://github.com/Helicone/ai-gateway>
- Helicone Custom Properties: <https://docs.helicone.ai/helicone-headers>
- BricksLLM: <https://github.com/bricks-cloud/BricksLLM>
- GeekAI Chat Completions: <https://docs.geekai.co/cn/api/chat/completions>
- GeekAI 对话账单: <https://docs.geekai.co/cn/api/credit/transaction>

## 4. 总体设计原则

### 4.1 主账本必须在 NextDevTpl

无论上游走哪个中转站：

- 用户身份归属在 `NextDevTpl`
- 工具归属在 `NextDevTpl`
- 积分余额归属在 `NextDevTpl`
- 统计报表归属在 `NextDevTpl`

上游中转站只负责提供模型调用，不负责你的业务主账本。

### 4.2 使用明细和余额账本分离

必须区分两类记录：

- AI 使用明细
  - 记录一次请求调用了什么、走了哪个上游、消耗了多少 token、真实成本是多少
- 积分账本
  - 记录用户余额如何变化

原因：

- AI 使用明细是事实记录
- 积分账本是财务结果
- 一次请求可能失败但产生少量成本，也可能成功但不扣费，也可能后续退款

### 4.3 路由层和计费层分离

必须区分两类逻辑：

- 路由逻辑
  - 决定走哪个中转站、哪个模型、哪个分组
- 计费逻辑
  - 决定本次扣多少积分

这样后续切换上游时，不会影响业务计费规则。

### 4.4 先保证准确，再考虑复杂调度

第一阶段重点是：

- 每次请求都能落日志
- 成功请求都能精确结算
- 失败请求能明确区分是上游失败、超时、风控还是余额不足

第一阶段不追求：

- 极其复杂的负载均衡算法
- 自动学习最优路由
- 跨站点成本套利

## 5. 推荐总体架构

推荐结构如下：

```text
redink / jingfang-ai / 其他工具
            |
            v
    NextDevTpl 平台 API
            |
            +-- 统一鉴权
            +-- 工具配置解析
            +-- 路由决策
            +-- usage 记录
            +-- 成本结算
            +-- 积分扣费
            |
            v
  上游中转站 A / B / C
  GeekAI / 云雾 / 其他 OpenAI 兼容站
```

工具以后不直接调用上游中转站，而是统一调用 `NextDevTpl`。

## 6. 完整实施路线

为了让文档可以直接指导开发，后续按 6 个阶段推进。

### 6.1 Phase 0：统一概念与最小约束

目标：

1. 统一命名
2. 确认数据口径
3. 避免后续实现走歪

本阶段要确认的约定：

- `toolKey`
  - 工具标识，例如 `redink`、`jingfang-ai`
- `featureKey`
  - 工具内功能标识，例如 `rewrite`、`outline`、`case-analysis`
- `requestType`
  - 当前先支持 `chat`
- `provider`
  - 上游中转站实例，例如 `geek-default`
- `modelKey`
  - 平台内部统一模型名，例如 `gpt-4o-mini`
- `modelAlias`
  - 发给上游的真实模型名
- `requestId`
  - 平台侧 AI 请求幂等主键
- `attemptNo`
  - 某次请求的第几次上游尝试

本阶段完成后预期：

- 所有后续表结构和接口都按同一命名实现
- 后续每一笔扣费都能追到具体请求和具体上游尝试

### 6.2 Phase 1：单上游闭环

目标：

1. 跑通 `tool -> NextDevTpl -> 单中转站`
2. 跑通使用明细与积分扣费闭环
3. 先覆盖同步 `chat` 请求

本阶段范围：

- 单上游 provider
- 单模型或少量固定模型
- 固定积分计费优先
- 同步非流式返回优先

交付结果：

- `POST /api/platform/ai/chat`
- 请求明细表
- 计费规则表
- 基础后台列表
- 基础测试

### 6.3 Phase 2：多中转站与回退

目标：

1. 支持多个中转站
2. 支持按优先级回退
3. 精确记录每次尝试及其成本

本阶段范围：

- `priority_failover`
- `primary_only`
- provider 健康状态
- 尝试级日志

交付结果：

- provider 表
- model 绑定表
- attempt 表
- 优先级回退策略
- provider 后台管理页面

### 6.4 Phase 3：成本精算与 token 计费

目标：

1. 从“功能固定积分”扩展到“按 usage / 成本”计费
2. 实现更准确的成本统计
3. 明确“真实成本”和“用户扣费”是两个口径

本阶段范围：

- token 计费
- 成本计算规则
- 成本与积分对账
- billing record

交付结果：

- token-based pricing rule
- billing record 表
- 成本统计面板
- 对账视图

### 6.5 Phase 4：流式、更多请求类型与后台增强

目标：

1. 支持 `stream=true`
2. 为图像、语音等后续能力预留统一结构
3. 完善后台统计和排障能力

本阶段范围：

- 流式 chat
- request type 扩展
- dashboard 汇总
- 失败原因统计

交付结果：

- 流式 AI 接口
- 更完整的后台报表
- 时间维度聚合统计

当前落地说明：

- 本轮已先落地最小流式能力，即 `stream=true` 时返回标准 SSE
- 当前仍以 `chat` 为唯一 request type
- 后续如果需要图像、语音、视频，可继续沿用当前账本和路由结构扩展

### 6.6 Phase 5：运营化与长期维护

目标：

1. 提供稳定的运营和核账手段
2. 提供低风险扩展点
3. 为未来是否引入 LiteLLM 预留接口

本阶段范围：

- 成本异常预警
- provider 失效切换
- 人工调账
- 账本核对流程

交付结果：

- 异常检测
- 手工调账能力
- provider 诊断工具
- 运维流程文档

当前落地说明：

- 本轮已先落地最小运营摘要接口 `GET /api/platform/ai/summary`
- 当前已能支撑管理员查看总览和 provider 统计
- 更复杂的异常预警、手工调账、自动下线后续可在现有结构上继续追加

## 7. 目标能力边界

为了避免范围膨胀，必须明确哪些能力在本方案内，哪些不在。

### 7.1 本方案负责的能力

- 统一工具请求入口
- 统一用户鉴权
- 统一模型配置和路由
- 统一请求日志
- 统一成本统计
- 统一积分扣费
- 统一后台统计与排障

### 7.2 本方案暂不负责的能力

- 取代所有第三方 AI 网关
- 自动同步上游账单页面
- 替代支付系统
- 复杂订阅账单引擎
- 通用工作流编排平台

## 8. 最终数据模型

为了保证计费统计准确，最终建议落地 6 张核心表。

### 8.1 `ai_relay_provider`

职责：

- 存中转站定义
- 存一个可实际调用的上游入口

建议字段：

- `id`
- `key`
- `name`
- `providerType`
  - 例如 `openai_compatible`
- `baseUrl`
- `apiKeyEncrypted`
- `enabled`
- `priority`
- `weight`
- `requestType`
- `metadataJson`
- `lastHealthAt`
- `lastHealthStatus`
- `createdAt`
- `updatedAt`

说明：

- GeekAI、云雾、其他 OpenAI 兼容中转站，都统一视为一个 provider
- 如果云雾的不同分组要分开统计，建议拆成独立 provider

### 8.2 `ai_relay_model_binding`

职责：

- 描述某个 provider 支持哪些模型
- 描述该模型在这个 provider 上的路由和成本参数

建议字段：

- `id`
- `providerId`
- `modelKey`
- `modelAlias`
- `enabled`
- `priority`
- `weight`
- `costMode`
  - `manual`
  - `fixed`
- `inputCostPer1k`
- `outputCostPer1k`
- `fixedCostUsd`
- `maxRetries`
- `timeoutMs`
- `metadataJson`
- `createdAt`
- `updatedAt`

说明：

- `modelKey` 是平台内部统一模型名
- `modelAlias` 是发给上游的模型名
- 同一个 `modelKey` 可以绑定多个 provider

### 8.3 `ai_pricing_rule`

职责：

- 定义平台如何向用户计费

建议字段：

- `id`
- `toolKey`
- `featureKey`
- `requestType`
- `billingMode`
  - `fixed_credits`
  - `token_based`
  - `cost_plus`
- `modelScope`
- `fixedCredits`
- `inputTokensPerCredit`
- `outputTokensPerCredit`
- `costUsdPerCredit`
- `minimumCredits`
- `enabled`
- `createdAt`
- `updatedAt`

说明：

- `toolKey + featureKey + requestType` 是主业务维度
- `modelScope` 用于将来少数模型走特殊计费

### 8.4 `ai_request_log`

职责：

- 记录每一次平台 AI 请求的业务事实

建议字段：

- `id`
- `requestId`
- `userId`
- `toolKey`
- `featureKey`
- `requestType`
- `requestedModel`
- `resolvedModel`
- `routeStrategy`
- `status`
  - `pending`
  - `success`
  - `failed`
  - `insufficient_credits`
  - `billing_failed`
- `billingMode`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `providerCostUsd`
- `chargedCredits`
- `attemptCount`
- `winningAttemptNo`
- `latencyMs`
- `errorCode`
- `errorMessage`
- `requestBodyJson`
- `responseMetaJson`
- `metadataJson`
- `createdAt`
- `updatedAt`

说明：

- 这是平台主事实表
- 一条记录对应一次业务请求，不对应单次上游尝试

### 8.5 `ai_request_attempt`

职责：

- 记录某次请求的每一次上游尝试

建议字段：

- `id`
- `requestId`
- `attemptNo`
- `providerId`
- `providerKey`
- `modelKey`
- `modelAlias`
- `status`
  - `success`
  - `failed`
  - `timeout`
  - `rejected`
- `httpStatus`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `providerCostUsd`
- `latencyMs`
- `errorCode`
- `errorMessage`
- `requestMetaJson`
- `responseMetaJson`
- `createdAt`

说明：

- 只要未来支持回退，就必须有 attempt 表
- 没有它，后续多 provider 成本核对会不准确

### 8.6 `ai_billing_record`

职责：

- 把 AI 请求结果和积分账本结果做一对一关联

建议字段：

- `id`
- `requestId`
- `userId`
- `billingMode`
- `chargedCredits`
- `creditsTransactionId`
- `status`
  - `charged`
  - `skipped`
  - `reversed`
- `reason`
- `createdAt`
- `updatedAt`

说明：

- `creditsTransaction` 继续做用户钱包账本
- `ai_billing_record` 负责 AI 请求与钱包账本之间的桥接
- 这样后续退款、补偿、调账会更清晰

## 9. 与现有代码的衔接方式

### 9.1 继续复用的现有模块

- `src/features/credits/core.ts`
  - 继续负责钱包扣减
- `src/app/api/platform/session/route.ts`
  - 继续给工具侧返回用户、套餐、积分
- `src/app/api/platform/credits/check/route.ts`
  - 可继续保留，兼容旧工具
- `src/app/api/platform/credits/consume/route.ts`
  - 可继续保留，兼容按次调用工具自己扣费
- `src/features/tool-config/service.ts`
  - 继续负责工具配置和运行时配置解析
- `src/lib/ai/openai.ts`
  - 改造成“上游调用适配层”

### 9.2 必须新增的模块

- `src/features/ai-gateway/*`
- `src/app/api/platform/ai/chat/route.ts`
- 后台管理页面：
  - `/[locale]/admin/ai/providers`
  - `/[locale]/admin/ai/pricing`
  - `/[locale]/admin/ai/requests`

### 9.3 必须改造的现有模块

#### `src/lib/ai/openai.ts`

当前问题：

- 只返回文本
- 不暴露 usage
- 不支持 provider metadata
- 不支持动态上游映射

需要改造为：

- 输入 provider/baseUrl/apiKey/modelAlias
- 返回完整结果：
  - `content`
  - `usage`
  - `model`
  - `responseId`
  - `raw`

#### `src/features/tool-config/service.ts`

继续保留现有通用槽位模式，但要补充稳定映射约定。

#### `src/lib/logger/index.ts`

补充事件类型：

- `ai.request.started`
- `ai.request.completed`
- `ai.request.failed`
- `ai.request.billed`

## 10. 工具配置如何调整

当前项目已经有 `tool-config`，建议继续复用。

### 10.1 工具配置继续负责什么

- 某个工具默认走哪个模型
- 某个工具是否允许用户自定义模型
- 某个工具允许使用哪些功能
- 某个工具路由策略使用哪套
- 某个工具默认优先 provider

### 10.2 工具配置不负责什么

- 不负责维护完整 provider 库
- 不负责维护平台计费规则
- 不负责存全局模型成本表

### 10.3 建议新增的工具槽位含义

结合当前通用槽位方案，建议按工具约定以下语义：

- `config1`
  - 默认模型，例如 `gpt-4o-mini`
- `config2`
  - 路由策略，例如 `primary_only`、`priority_failover`、`weighted`
- `config3`
  - 默认 provider key，例如 `geek-default`
- `json1`
  - 允许模型列表
- `json2`
  - 该工具的 feature 配置
- `json3`
  - 该工具允许使用的 provider 列表
- `text1`
  - 默认系统提示词

### 10.4 feature 配置建议结构

`json2` 建议采用类似结构：

```json
{
  "rewrite": {
    "enabled": true,
    "billingMode": "fixed_credits",
    "defaultCredits": 3
  },
  "outline": {
    "enabled": true,
    "billingMode": "fixed_credits",
    "defaultCredits": 2
  },
  "case-analysis": {
    "enabled": true,
    "billingMode": "token_based",
    "minimumCredits": 20
  }
}
```

平台不会把这份 JSON 当最终计费依据，但它可以作为工具本地默认值和 UI 配置来源。

## 11. 路由设计

### 11.1 最终支持的三种策略

#### `primary_only`

只走一个上游。

适合：

- 某个工具长期绑定某个中转站
- 成本和质量都比较稳定

#### `priority_failover`

按优先级依次尝试，失败再切下一个。

适合：

- 主渠道明确
- 只把其他渠道当兜底

这是推荐的默认策略。

#### `weighted`

按权重随机分流。

适合：

- 多个上游都稳定
- 你希望平衡风险和成本

### 11.2 路由决策输入

路由器至少读取这些维度：

- `toolKey`
- `featureKey`
- `requestedModel`
- 工具配置里的 provider 白名单
- provider 可用性
- model binding 状态
- 路由策略

### 11.3 路由决策输出

路由器至少输出：

- 选中的 provider
- 选中的 modelAlias
- 备选 provider 列表
- 本次是否允许回退
- 超时时间

### 11.4 为什么第一阶段默认用 `priority_failover`

因为它最符合你当前需求：

- 易于理解
- 易于测试
- 日志清晰
- 不会像 weighted 一样增加随机性
- 比单通道更稳

## 12. 请求接口设计

### 12.1 统一接口

首个统一入口：

- `POST /api/platform/ai/chat`

### 12.2 请求体建议

```json
{
  "tool": "redink",
  "feature": "rewrite",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": false,
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "metadata": {
    "source": "editor",
    "draftId": "draft_xxx"
  }
}
```

### 12.3 响应体建议

```json
{
  "success": true,
  "requestId": "air_xxx",
  "provider": "geek-default",
  "model": "gpt-4o-mini",
  "content": "生成结果",
  "usage": {
    "promptTokens": 123,
    "completionTokens": 456,
    "totalTokens": 579
  },
  "billing": {
    "chargedCredits": 3,
    "billingMode": "fixed_credits",
    "remainingBalance": 102
  }
}
```

### 12.4 错误响应建议

需要统一错误码：

- `unauthorized`
- `invalid_request`
- `feature_disabled`
- `model_not_allowed`
- `insufficient_credits`
- `provider_unavailable`
- `upstream_timeout`
- `upstream_error`
- `billing_failed`

## 13. 完整请求处理流程

### 13.1 同步请求流程

1. 校验当前用户会话
2. 校验 `tool`、`feature`、`messages`
3. 读取工具运行配置
4. 确认 feature 是否启用
5. 解析请求模型
6. 校验模型是否在允许列表内
7. 查找 `ai_pricing_rule`
8. 检查最低余额门槛
9. 创建 `ai_request_log(status=pending)`
10. 路由器选出 provider 候选
11. 发起第 1 次上游调用
12. 写 `ai_request_attempt`
13. 若失败且允许回退，则尝试下一个 provider
14. 若最终成功：
    - 汇总 usage
    - 计算平台成本
    - 执行积分扣费
    - 写 `ai_billing_record`
    - 更新 `ai_request_log`
15. 若最终失败：
    - 更新 `ai_request_log`
    - 不扣费或按规则处理
16. 返回响应

### 13.2 为什么必须先写 `ai_request_log`

因为：

- 即使上游失败，也必须留痕
- 否则后台无法统计失败率和真实调用量
- 也无法做后续补偿或排障

## 14. 成本计算设计

### 14.1 成本来源优先级

优先级建议如下：

1. 平台手工配置成本表
2. 中转站明确可用的分组倍率
3. 无法精确计算时仅记录 token，不记录成本

原因：

- 云雾这类中转站会有分组和倍率差异
- GeekAI 这类平台可能做了动态负载或供应商聚合
- 不能把上游价格视为稳定事实

### 14.2 推荐做法

平台自己维护成本参数：

- `inputCostPer1k`
- `outputCostPer1k`

使用返回的 usage 做平台侧成本计算：

```text
providerCostUsd =
  promptTokens / 1000 * inputCostPer1k +
  completionTokens / 1000 * outputCostPer1k
```

### 14.3 关于中转站分组的处理方式

像云雾这种存在“分组差异、倍率差异”的平台，建议：

- 每个分组单独建 provider
- 不要在一个 provider 里混多个分组

例如：

- `yunwu-openai-official`
- `yunwu-openai-cheap`
- `yunwu-claude-main`

这样成本、失败率、稳定性才能准确统计。

### 14.4 关于 GeekAI 这类聚合站的处理方式

如果上游本身就做了供应商动态调度，平台也不需要感知其内部细节。

平台侧只需要：

- 把 GeekAI 当成一个 provider
- 记录对 GeekAI 的真实请求和返回
- 用本地成本参数进行成本核算

## 15. 计费结算设计

### 15.1 最终支持三种计费模式

#### `fixed_credits`

说明：

- 某个 feature 成功后固定扣积分

适合：

- 标题生成
- 文案改写
- 摘要生成
- 结构化输出

#### `token_based`

说明：

- 根据 usage 动态扣积分

适合：

- 长文本分析
- 高成本推理
- 输出长度变化大的功能

#### `cost_plus`

说明：

- 按平台成本换算，再加一个业务倍率

适合：

- 以后要做更精细盈利控制
- 某些工具需要严格按成本定价

第一阶段不启用。

### 15.2 推荐结算规则

- `fixed_credits`
  - 成功后扣费
- `token_based`
  - 成功后根据 usage 计算
- 失败请求
  - 默认不扣积分
- 多次重试但最终成功
  - 用户只扣一次
  - 平台成本按实际所有 attempt 汇总
- 上游返回 usage 但业务失败
  - 默认记录成本但不扣积分
  - 后续可按 feature 规则细化

### 15.3 为什么要把“成本”和“扣费”拆开

因为：

- 平台可能因为回退而承担额外成本
- 平台可能对用户按固定价收费
- 平台真实成本和用户账单本来就不是同一个口径

## 16. 余额与预扣策略

### 16.1 第一阶段策略

第一阶段采用：

1. 调用前最低余额检查
2. 调用成功后实际扣费

这与当前 `credits` 模块最匹配，实现最简单。

### 16.2 第二阶段可选增强

如果后续高成本请求增多，可以追加：

- 预占额度
- 请求结束后释放或结算

但这会要求当前积分系统新增：

- `reservedBalance`
- 预占流水
- 释放流水

当前不建议一开始就做。

## 17. 后台管理设计

后台建议分成 6 个模块。

### 17.1 Provider 管理

展示：

- provider 名称
- baseUrl
- requestType
- 启用状态
- 优先级
- 权重
- 健康状态
- 最近错误率
- 最近平均延迟
- 最近总成本

### 17.2 Model Binding 管理

展示：

- provider
- modelKey
- modelAlias
- input/output 成本参数
- timeout
- maxRetries
- 启用状态

### 17.3 Pricing Rule 管理

展示：

- toolKey
- featureKey
- billingMode
- fixedCredits
- token 规则
- minimumCredits
- 启用状态

### 17.4 AI 请求明细

展示：

- 时间
- 用户
- 工具
- feature
- provider
- model
- tokens
- 成本
- 扣费
- attemptCount
- 状态
- 错误信息

### 17.5 AI 尝试明细

展示：

- requestId
- attemptNo
- provider
- latency
- httpStatus
- usage
- 成本
- 失败原因

### 17.6 AI 核账视图

展示：

- 某时间段总请求数
- 总成功数
- 总失败数
- 总上游成本
- 总扣费积分
- 成本最高工具
- 失败率最高 provider

## 18. 分阶段开发清单

### 18.1 Phase 0 开发清单

1. 明确 `toolKey / featureKey / requestType / provider / modelKey` 命名约定
2. 补充文档和常量定义
3. 选定第一批工具和 feature
4. 选定第一批 provider 和模型

预期效果：

- 没有歧义命名
- 后续开发不再反复改表和改接口字段

### 18.2 Phase 1 开发清单

1. 新增 `ai_request_log`
2. 新增 `ai_pricing_rule`
3. 改造 `src/lib/ai/openai.ts`
4. 新增 `src/features/ai-gateway/service.ts`
5. 新增 `POST /api/platform/ai/chat`
6. 支持单 provider 调用
7. 支持固定积分结算
8. 新增基础后台列表

预期效果：

- 工具已经可以不直接调上游
- 平台已经能看到每次请求和扣费

### 18.3 Phase 2 开发清单

1. 新增 `ai_relay_provider`
2. 新增 `ai_relay_model_binding`
3. 新增 `ai_request_attempt`
4. 新增 provider 路由器
5. 支持 `priority_failover`
6. 支持 provider 后台管理

预期效果：

- 单个上游挂掉不再直接影响工具可用性
- 后台能精确看到每次回退

### 18.4 Phase 3 开发清单

1. 新增 `ai_billing_record`
2. 支持 `token_based`
3. 支持平台成本计算
4. 支持账本关联查询
5. 新增核账视图

预期效果：

- 平台已经能区分“真实成本”和“用户扣费”
- 可以按工具评估盈利情况

### 18.5 Phase 4 开发清单

1. 支持 `stream=true`
2. 支持更完整的 request type 抽象
3. 新增更丰富的 dashboard
4. 支持 provider 健康检查任务

预期效果：

- 复杂工具也能统一接入
- 后台统计和诊断能力足够日常运营

### 18.6 Phase 5 开发清单

1. 支持手工调账
2. 支持异常成本预警
3. 支持 provider 异常下线
4. 输出运维手册
5. 预留 LiteLLM 兼容接入点

预期效果：

- 系统能长期稳定运营
- 后续更换上游时不破坏主账本

## 19. 分阶段测试方案

每个阶段都必须有实际验证，不能只做静态阅读。

### 19.1 Phase 0 测试

验证内容：

- feature 命名是否统一
- 第一批工具和 provider 是否确认

验证方式：

- 文档检查
- 配置示例检查

通过标准：

- 第一批功能列表和 provider 列表已经固定

### 19.2 Phase 1 测试

需要新增的测试：

- `ai chat` 成功请求
- `insufficient_credits`
- `feature_disabled`
- 请求日志写入
- 固定积分扣费
- 失败请求不扣费

推荐测试层级：

- 单元测试
  - 计费规则匹配
  - usage 解析
- 集成测试
  - 路由 handler
  - credits 扣费
- 最小真实验证
  - 本地接一个真实中转站或 mock OpenAI 兼容服务

通过标准：

- 一次成功请求能看到：
  - `ai_request_log`
  - `credits_transaction`
  - 正确响应

### 19.3 Phase 2 测试

需要新增的测试：

- 主 provider 成功
- 主 provider 失败后自动回退
- 多次 attempt 正确写入
- 最终只对用户扣一次费
- 总成本等于所有 attempt 成本汇总

通过标准：

- 回退链路完全可追踪
- 核账数据一致

### 19.4 Phase 3 测试

需要新增的测试：

- token-based billing
- 成本计算
- billing record 与 creditsTransaction 对齐
- 成本和扣费分离

通过标准：

- 能从一个 requestId 追到：
  - 请求日志
  - 尝试日志
  - 钱包扣费
  - 最终结算

### 19.5 Phase 4 测试

需要新增的测试：

- 流式成功
- 流式中断
- 流式失败不扣费
- request type 扩展场景

通过标准：

- 流式请求也能稳定写账本

### 19.6 Phase 5 测试

需要新增的测试：

- 手工调账
- 异常 provider 下线
- 成本预警阈值
- 运营后台筛选与统计

通过标准：

- 运维动作不会破坏账本一致性

## 20. 阶段验收标准

### 20.1 Phase 1 验收

- 至少 1 个工具已改为走 `POST /api/platform/ai/chat`
- 至少 1 个 provider 可真实调用
- 请求日志和扣费日志都正确

### 20.2 Phase 2 验收

- 至少 2 个 provider 可配置
- 回退策略已上线
- attempt 统计可查看

### 20.3 Phase 3 验收

- 至少 1 个 feature 采用 token 计费
- 成本和用户扣费可分开汇总
- 后台能按工具看盈利口径

### 20.4 Phase 4 验收

- 流式工具可接入
- dashboard 基本满足运营查看

### 20.5 Phase 5 验收

- 运维和调账能力可用
- provider 管理流程稳定
- 后续接更多工具不需要改主账本结构

## 21. 风险与应对

### 21.1 上游 usage 不一致

风险：

- 不同中转站可能返回 usage 字段不同

应对：

- 平台内部统一 usage 解析结构
- 缺失 usage 时标记为 `usage_missing`

### 21.2 上游价格不透明

风险：

- 中转站价格和倍率可能变动

应对：

- 平台自己维护成本参数
- provider 按分组拆分

### 21.3 工具 feature 命名混乱

风险：

- 后续统计口径被打碎

应对：

- featureKey 必须先在平台侧注册
- 不允许工具随意拼新名字直接上线

### 21.4 流式结算复杂

风险：

- 流式中断和半成功难结算

应对：

- 非流式先上线
- 流式单独一个阶段

## 22. 推荐的开发先后顺序

如果要直接排期开发，推荐按下面顺序：

1. 改 `src/lib/ai/openai.ts`
2. 新增 `ai_request_log`
3. 新增 `ai_pricing_rule`
4. 新增 `POST /api/platform/ai/chat`
5. 让第一个工具接入
6. 再做 provider / model binding
7. 再做 attempt 表和回退
8. 再做 token 计费和 billing record
9. 再做流式和后台增强

这样路径最短，也最符合当前仓库状态。

## 23. 明确不推荐的方案

### 23.1 不推荐直接把 one-api / new-api 放在前面

原因：

- 会复制用户、令牌、额度体系
- 会让 `NextDevTpl` 的积分体系失去主导权
- 工具、用户、订单、余额会出现双账本

### 23.2 不推荐先引入 OpenMeter

原因：

- 当前阶段过重
- 你的第一目标是闭环，不是复杂 billing 基础设施

### 23.3 不推荐先做全量流式复杂结算

原因：

- 流式、断流、部分响应、重连会快速放大复杂度
- 第一阶段应先保证同步调用链路准确

## 24. 最终建议

最终建议非常明确：

1. `NextDevTpl` 继续做唯一业务主账本
2. 工具以后统一调用 `NextDevTpl`
3. `NextDevTpl` 内新增 provider、model binding、request、attempt、billing、pricing 这几层
4. 第一阶段先用同步 chat + 固定积分把闭环跑通
5. 第二阶段做多 provider 和回退
6. 第三阶段再做 token 计费和精细成本统计
7. 第四阶段再上流式和更多请求类型
8. 第五阶段再补调账、预警和长期运维能力

这套方案的好处是：

- 足够简单
- 与当前项目最契合
- 不需要引入新的主计费平台
- 后续无论上游是 GeekAI、云雾还是其他兼容站，统计口径都保持一致
- 以后若真的需要 LiteLLM，也只会作为 `NextDevTpl` 后面的上游网关，而不是主账本

## 25. 本轮总结

本轮把文档从“第一阶段计划”扩充成了完整开发蓝图，补齐了：

- 最终数据模型
- 各阶段开发目标
- 接口设计
- 路由与结算逻辑
- 后台模块
- 分阶段测试方案
- 验收标准
- 风险与应对
- 多模态接入时对 one-api、new-api、LiteLLM、Helicone、OpenMeter、BricksLLM、GeekAI 的可借鉴点
- `NextDevTpl` 自研多模态时的统一消息结构、资产入口、能力表、usage 结构和 adapter 分层约束

本轮验证方式：

- 结合当前仓库已有积分、工具配置、AI 客户端实现进行结构核对
- 参考 one-api、LiteLLM、OpenMeter、Helicone 的公开设计思路
- 结合 GeekAI、云雾这类中转站的兼容接口和分组差异特征进行约束收敛
