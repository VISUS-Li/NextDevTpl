# 分销接入完整方案

## 1. 文档目的

这份文档有两个目标：

1. 把 `~/code/guns-distribution` 的分销业务链路彻底拆清楚
2. 结合 `tripsass/NextDevTpl` 现有支付、订阅、积分逻辑，给出一套可以落地、可分阶段验证、能支持消费后分销分润的接入方案

结论先写在前面：

- `guns-distribution` 的核心不是“分销码”，而是“成员树 + 分润参数 + 分润事件 + 分润记录 + 账户流水 + 提现状态机”
- `tripsass` 现阶段还没有统一订单中心，也没有分销归因、佣金账本、退款冲正、提现流程
- `guns-distribution` 的模型值得参考，但不能原样搬进 `tripsass`
- `tripsass` 的正确做法是保留现有支付入口，在项目内新增原生分销域，并以“统一订单事件”驱动分润
- `tripsass` 应继续复用现有统一用户账号体系，后续即使接入微信支付、支付宝，也不拆第二套会员账号


## 2. tripsass 当前现状

先看当前代码里已经有什么。

### 2.1 已有能力

- 认证：`src/db/schema.ts` 中的 `user/session/account`
- 订阅支付入口：`src/features/payment/actions.ts`
- 积分购买入口：`src/features/credits/actions.ts`
- Creem Webhook：`src/app/api/webhooks/creem/route.ts`
- 订阅表：`src/db/schema.ts` 中的 `subscription`
- 积分账本：`src/db/schema.ts` 中的 `credits_balance`、`credits_batch`、`credits_transaction`
- 积分核心记账：`src/features/credits/core.ts`
- 后台页面骨架：`src/app/[locale]/(admin)/admin/*`
- 支付和积分测试：`src/test/payment/*`、`src/test/credits/*`

### 2.2 当前缺口

这些缺口如果不先承认，后面的分销方案一定会做歪。

1. 还没有完整统一订单中心，当前只补了 `sales_order` / `sales_order_item` 最小骨架
2. 还没有分销归因模型，Checkout metadata 里也没有 referral 相关字段
3. 还没有佣金账本，积分账本不能直接拿来记现金佣金
4. 还没有提现申请、审核、打款、拒绝、冲正流程
5. 还没有退款或拒付驱动的佣金冲正逻辑
6. 还没有订单事件幂等表，分润执行无法严格防重
7. 还没有支付提供商抽象，当前主要围绕 Creem
8. 还没有完整售后状态流，退货、部分退款、全额退款、拒付还没有统一建模

### 2.3 需要先点明的一个现实问题

`src/features/credits/actions.ts` 在创建积分购买 Checkout 时写入了：

- `metadata.type = "credit_purchase"`
- `metadata.credits`
- `metadata.packageId`

但 `src/app/api/webhooks/creem/route.ts` 当前并没有真正处理 `credit_purchase` 的下单落库和分润触发，只是处理了订阅相关逻辑。

也就是说：

- 当前项目的“积分包支付完成”与“统一订单驱动分润”之间，实际还缺关键一段
- 文档必须先把这一段补进主链路，后续开发才能闭环

当前进度更新：

- 这一段已经补上第一步
- `src/app/api/webhooks/creem/route.ts` 已经开始真实处理 `credit_purchase`
- 当前效果是“积分包 Checkout -> 支付成功 -> Creem webhook -> 发放积分”已经闭环
- 同一笔积分购买已经补了幂等保护，重复 webhook 不会重复发积分
- 当前还额外补上了 `sales_order` / `sales_order_item` 最小落单
- 当前已经继续补上统一订单服务层，`checkout.completed`、`subscription.active`、`subscription.renewed` 已开始复用同一层落单
- 当前已经继续补上标准化 `PaymentOrderPayload` 和订单显式归因字段
- 当前已经继续补上统一售后事件流，退款、拒付、退货可以先走内部统一模型
- 但这一步还不是完整订单中心，目前仍然缺少支付渠道原生售后事件接入


## 3. guns-distribution 的完整业务逻辑

下面这部分只讲代码里真正存在的逻辑。

### 3.1 核心模块结构

`guns-distribution` 的分销域主要由这几块组成：

- 会员：`DistMemberServiceImpl`
- 账户：`DistAccountServiceImpl`
- 分润参数：`DistProfitParamServiceImpl`
- 分润事件：`DistProfitEventServiceImpl`
- 分润记录：`DistProfitRecordServiceImpl`
- 提现：`DistWithdrawRecordServiceImpl`
- 分润策略：`TradeProfitStrategy`、`InviteProfitStrategy`、`RankProfitStrategy`
- 事件监听：`ProfitEventListener`
- APP API：`MemberApiController`、`ProfitApiController`、`WithdrawApiController`
- 控制台统计：`DistDashboardServiceImpl`

它本质上是一个完整分销中心，而不是订单系统的一个小插件。

### 3.2 数据模型

SQL 里真正承担分销业务的核心表如下。

#### 3.2.1 `dist_member`

职责：记录分销成员和上下级关系。

关键字段：

- `member_username`：外部系统的用户唯一标识
- `fir_parent`、`sec_parent`、`thr_parent`：一二三级上级
- `parent_path`：祖先路径
- `member_type`：会员身份
- `member_rank`：会员段位
- `state`

特点：

- 默认最多记录三级上级，长度由 `GUNS_DIST_PARENT_PATH_LENGTH` 控制
- 新会员如果带 `firParent`，就会在新增时绑定上级并写出祖先链

#### 3.2.2 `dist_account`

职责：成员账户总账。

字段分两类：

- 现金佣金：`money_total`、`money_available`、`money_frozen`
- 积分：`integral_total_history`、`integral_total`、`integral_available`、`integral_frozen`

这是 `guns-distribution` 里一个非常重要的设计点：

- 佣金和积分放在同一个账户实体里
- 对 `tripsass` 来说，这个思路可以参考，但不能照搬

#### 3.2.3 `dist_profit_param`

职责：定义分润规则。

规则维度：

- `account_type`：佣金或积分
- `profit_type`：交易、邀请、段位升级
- `calculate_mode`：百分比或固定值
- `profit_level`：自身、一级、二级、三级
- `member_type`
- `member_rank`
- `state`

这意味着 `guns-distribution` 的规则不是只按“第几级”算，还会受“成员身份”和“成员段位”影响。

#### 3.2.4 `dist_profit_event`

职责：记录一次“触发了分润”的业务事件。

关键字段：

- `profit_type`
- `trigger_member_username`
- `event_number`
- `event_price`
- `memo`

代码里的语义非常明确：

- 有分润事件，不代表一定有分润记录
- 有分润记录，一定能追溯到一个分润事件

#### 3.2.5 `dist_profit_record`

职责：记录某个成员因某次事件获得了多少收益。

关键字段：

- `event_id`
- `account_type`
- `impact_member_username`
- `income_amount`

一个事件可以产出多条记录。

#### 3.2.6 `dist_account_record`

职责：记录账户余额如何变化。

关键字段：

- `account_type`
- `before_change_total`
- `after_change_total`
- `change_amount`
- `change_type`
- `change_record_id`

它不是分润明细，而是账本流水。

#### 3.2.7 `dist_rank_param`

职责：定义段位区间。

关键字段：

- `member_rank`
- `begin_integral`
- `end_integral`

会员累计历史积分跨过区间后，会升级段位，并触发段位分润事件。

#### 3.2.8 `dist_withdraw_record`

职责：提现申请与处置状态。

关键字段：

- `withdraw_number`
- `withdraw_amount`
- `fee_amount`
- `dispose_state`
- `handle_time`

提现状态枚举：

- `WAIT_AUDIT`
- `WAIT_REMIT`
- `DONE_REMIT`
- `REJECT`

### 3.3 会员新增链路

入口：`MemberApiController.add -> DistMemberServiceImpl.add`

真实执行顺序：

1. 校验 `member_username` 不重复
2. 生成 `DistMember`
3. 如果带 `firParent`，查父级会员
4. 通过 `setParentInfo` 写入 `fir_parent/sec_parent/thr_parent/parent_path`
5. 保存 `dist_member`
6. 同时创建一条 `dist_account`
7. 如果是邀请加入，发布 `InviteMemberEvent`

其中 `InviteMemberEvent` 的处理方式很关键：

- 监听器 `ProfitEventListener` 使用 `@TransactionalEventListener(phase = AFTER_COMMIT)`
- 并且是 `@Async`

这表示：

- 会员新增事务必须先提交成功
- 提交成功后，才异步跑邀请分润

这个思路对 `tripsass` 很有价值：

- 归因绑定和分润执行要解耦
- 主交易成功后再发分润事件，不要在同一个入口里把所有业务搅在一起

### 3.4 分润策略总入口

统一入口在 `AbstractProfit.startProfit`。

顺序固定：

1. `setTenantForCurrentThread`
2. `validateBiz`
3. `recordEvent`
4. `executeProfit`
5. `pushEvent`

其中最重要的是：

- 先写分润事件
- 再执行分润
- 最后推送通知

这就是 `guns-distribution` 的主闭环。

### 3.5 交易分润逻辑

入口：

- `ProfitApiController.trade`
- 发布 `TradeGoodsEvent`
- `ProfitEventListener.handle(TradeGoodsEvent)` 同步执行
- `TradeProfitStrategy.startProfit`

具体逻辑：

1. 校验触发人存在
2. 写入一条 `dist_profit_event`
3. 组装分润路径：
   - 当前触发人自己
   - 再拼接 `parent_path`
4. 把路径拆成数组，逐级遍历
5. 每一层用 `ProfitLevelEnum.matches(level)` 匹配 `ZERO/ONE/TWO/THREE`
6. 针对当前成员，分别查：
   - 佣金参数 `account_type = MONEY`
   - 积分参数 `account_type = INTEGRAL`
7. 如果佣金参数不存在，当前成员直接跳过
8. 如果佣金参数存在，则执行 `profit()`

`profit()` 内部又会做：

1. 计算佣金值
2. 写 `dist_profit_record`
3. 写 `dist_account_record`
4. 更新 `dist_account.money_total/money_available`
5. 如果有积分参数，再额外写积分分润记录和账户流水
6. 最后调用 `upgradeMemberRankIf`

这个实现有几个必须记住的特点：

#### 特点 A：路径包含触发人自己

`guns-distribution` 的路径从触发人自己开始。

所以它天然支持：

- 自购返佣
- 一级返佣
- 二级返佣
- 三级返佣

只是是否真的发生，要看有没有配置对应 `profit_level` 规则。

#### 特点 B：交易分润支持百分比

只有 `TRADE` 分润允许 `PERCENTAGE`。

计算公式：

- `income = eventPrice * profitRatio`
- 再 `ROUND_DOWN` 截断到 2 位小数

#### 特点 C：积分和佣金可以同时发

同一个事件里，可以同时：

- 发现金佣金
- 发积分奖励

#### 特点 D：规则按获利人的身份和段位匹配

交易分润不是只看“这是一级”，还会看：

- 当前拿钱的人是什么会员类型
- 当前拿钱的人是什么段位

#### 特点 E：当前实现默认偏向“佣金参数优先”

代码里如果佣金参数不存在，会直接 `continue`，即使积分参数存在也不会单独执行。

这说明 `guns-distribution` 的现有实现并不是完全对称的双通道。

### 3.6 邀请分润逻辑

入口：

- 新增会员成功后发 `InviteMemberEvent`
- 监听器在事务提交后异步执行
- `InviteProfitStrategy.startProfit`

逻辑与交易分润非常像：

1. 先记录 `dist_profit_event`
2. 类型是 `INVITE`
3. 事件编号自动生成
4. 分润路径也是“自己 + 父级路径”
5. 遍历路径逐层查规则
6. 命中规则则调用 `profit()`

从 sample SQL 可以看出，邀请分润通常配置的是：

- `profit_type = INVITE`
- `calculate_mode = FIXED`
- `profit_level = ONE`
- 金额固定，例如 5 元

也就是说：

- 新会员加入后，直属邀请人拿固定奖励
- 这套奖励也会进账户，也会进账本

### 3.7 段位分润逻辑

入口：

- 任意一次 `profit()` 执行后
- `upgradeMemberRankIf(memberId)` 会检查累计历史积分
- 如果跨段位，则更新 `dist_member.member_rank`
- 并发布 `RankUpgradeEvent`
- 监听器在事务提交后异步执行 `RankProfitStrategy`

这条链路非常关键，因为它体现了 `guns-distribution` 的第二层抽象：

- 某些分润不是交易直接触发
- 而是由账户累计结果触发新的事件

对 `tripsass` 的启发是：

- 后续如果需要代理等级、业绩等级、月度晋升奖励，也应该用独立事件，不要耦在交易结算函数里

### 3.8 提现逻辑

入口：

- `WithdrawApiController.initiate`
- `DistWithdrawRecordServiceImpl.initiate`

#### 3.8.1 发起提现

顺序：

1. 校验会员存在
2. 校验账户状态可用
3. 计算手续费：
   - `fee = withdrawAmount * GUNS_DIST_WITHDRAW_RATIO`
4. 冻结总额：
   - `freezeMoney = withdrawAmount + fee`
5. 校验 `money_available > freezeMoney`
6. 创建 `dist_withdraw_record`
7. 写一条 `WITHDRAW_FREEZE` 的 `dist_account_record`
8. 账户变更：
   - `money_available -= freezeMoney`
   - `money_frozen += freezeMoney`

#### 3.8.2 审核提现

入口：后台审核调用 `audit`

如果拒绝：

1. 把冻结金额解冻
2. 写 `WITHDRAW_UNFREEZE`
3. 更新提现状态为 `REJECT`

如果通过：

- 当前代码只留下了待对接的打款位置
- 真实打款逻辑并没有集成

#### 3.8.3 确认打款

`doWithdrawDeposit` 只是模拟真正打款后的系统内处理：

1. 从冻结金额中扣减 `withdrawAmount + feeAmount`
2. 写 `WITHDRAW_DEPOSIT`
3. 账户变更：
   - `money_frozen -= frozen`
   - `money_total -= frozen`
4. 提现单状态改为 `DONE_REMIT`

这里可以看出 `guns-distribution` 的提现状态机是完整的，但外部打款能力是留空的。

### 3.9 首页和统计口径

`DistDashboardServiceImpl` 给 APP 首页提供四类口径：

- 今日交易额
- 今日分润额
- 今日邀请数
- 已提现/待打款
- 累计分润
- 累计团队数

这些统计都是从：

- 分润事件
- 分润记录
- 提现记录
- 成员关系

几张表拼出来的，不是直接看账户余额。

这说明如果 `tripsass` 要做后台统计：

- 必须把事件、记录、账本拆开
- 单靠余额表做不出完整可审计报表


## 4. guns-distribution 值得借鉴与不能照搬的部分

### 4.1 值得借鉴

1. 分销成员树是独立领域对象，不直接混在主用户表
2. 分润规则是配置化的，不写死在交易代码里
3. 分润事件和分润记录分离
4. 账户总账和账户流水分离
5. 邀请、交易、等级奖励使用事件驱动
6. 提现采用冻结、审核、打款、拒绝的状态机

### 4.2 不能照搬

1. 多租户平台模型
2. Java/Spring/Guns 后台结构
3. `dist_account` 同时承载佣金和积分
4. 交易事件直接以外部订单号作为唯一业务上下文
5. 规则维度一开始就把 `member_type + member_rank + level` 全塞满
6. 当前代码没有退款冲正、拒付、幂等重放、统一订单中心

### 4.3 必须补上的部分

`guns-distribution` 做得好的地方很多，但如果直接参考它实现 `tripsass`，还必须加上这些能力：

1. 统一订单表
2. Webhook 幂等
3. 退款/拒付驱动的佣金冲正
4. 订单项维度分润
5. 续费是否跟随首购归因的配置
6. 单独的佣金账本，不和积分账本混合
7. 售后状态流，至少覆盖退款、退货、部分退款、拒付
8. 多支付提供商抽象，避免分销域直接耦合 Creem


## 5. tripsass 的接入原则

`tripsass` 的分销必须遵循下面这几条原则。

### 5.1 保留支付入口，不新起支付系统

继续使用：

- `src/features/payment/actions.ts`
- `src/features/credits/actions.ts`
- `src/app/api/webhooks/creem/route.ts`

不要再搭一套外部下单系统。

但这里要补一个边界：

- 支付入口可以保留
- 支付提供商实现不能写死在分销域里

后续即使新增：

- 微信支付
- 支付宝
- 其他钱包或聚合支付

分销域仍然只认统一订单和统一售后事件，不直接认 Creem、微信、支付宝各自的原始事件结构。

### 5.2 统一以订单事件驱动分润

不能像现在这样：

- 有的支付只改订阅
- 有的支付只发积分
- 有的逻辑写在 action
- 有的逻辑写在 webhook

必须改成：

1. Checkout 创建时写入归因快照
2. Webhook 统一落 `sales_order`
3. 订单确认后发 `commission_event`
4. 分润引擎写 `commission_record`
5. 账本服务写 `commission_ledger`

### 5.3 佣金域必须独立于积分域

参考 `guns-distribution` 的“账户总账 + 流水”思想，但不要复用积分表。

正确做法：

- 积分继续走 `credits_*`
- 佣金新增 `commission_*`

### 5.3.1 用户账号必须继续统一

无论支付渠道怎么扩展，账号体系都必须继续统一到现有 `user` 表。

原则：

- 分销代理是现有用户的一个角色或资料扩展，不是第二套账号
- 微信支付、支付宝支付只增加支付渠道映射，不增加新的分销会员主表
- 所有订单、佣金、提现、归因都以 `user_id` 为中心关联

这点和 `guns-distribution` 不同：

- 它使用的是独立 `member_username`
- `tripsass` 应统一复用 `user.id`

### 5.3.2 接微信支付、支付宝时不拆账号

后续如果接入微信支付、支付宝，变化应只落在支付渠道接入层，不落在账号域和分销域。

必须坚持：

- 登录、注册、权限、会员身份继续复用现有 `user/session/account`
- 微信 `openid/unionid`、支付宝 `buyer_id` 这类渠道身份只做渠道映射
- 一个用户可以绑定多个支付渠道身份，但仍然只有一个站内账号
- 同一个用户来自不同支付渠道的订单，继续汇总到同一个 `user_id`

这意味着后续真正新增的通常只有：

- 支付下单适配器
- 支付 webhook 解析器
- 支付渠道客户映射表

而不是：

- 新会员表
- 新登录体系
- 新分销主体表

### 5.4 归因必须在支付前锁定

分销归因不能在 webhook 里猜。

必须在进入 Checkout 前就拿到：

- referral code
- 归属代理
- campaign
- landing path
- 首次触达时间

### 5.5 所有分润都必须可重放、可审计

最少要满足：

- 能查某个订单为什么分给了谁
- 能查命中了哪条规则
- 能查冻结、解冻、提现、冲正各自写了哪些账本流水


## 6. tripsass 目标领域模型

下面是建议新增的表和职责。

### 6.1 代理与归因

#### `distribution_profile`

职责：代理资料和关系树。

建议字段：

- `id`
- `user_id`
- `status`
- `agent_level`
- `display_name`
- `inviter_user_id`
- `path`
- `depth`
- `bound_at`
- `created_at`
- `updated_at`

说明：

- `user_id` 对应现有 `user.id`
- `path` 保留祖先链，用于多级分润
- `agent_level` 是代理等级，不等于订阅等级

#### `distribution_referral_code`

职责：推广码与推广链接配置。

建议字段：

- `id`
- `agent_user_id`
- `code`
- `campaign`
- `landing_path`
- `status`
- `created_at`
- `updated_at`

#### `distribution_attribution`

职责：把一次触达或一次绑定变成可复用的归因快照。

建议字段：

- `id`
- `visitor_key`
- `user_id`
- `agent_user_id`
- `referral_code`
- `campaign`
- `landing_path`
- `source`
- `bound_reason`
- `bound_at`
- `expires_at`
- `snapshot`

说明：

- 这张表是 `guns-distribution` 没有、但 `tripsass` 必须有的
- 它解决“用户在支付前通过哪个代理进入系统”的问题

### 6.2 统一订单中心

#### `sales_order`

职责：所有可结算收入事件的统一订单。

建议字段：

- `id`
- `user_id`
- `provider`
- `provider_order_id`
- `provider_checkout_id`
- `provider_subscription_id`
- `provider_payment_id`
- `order_type`
- `status`
- `after_sales_status`
- `currency`
- `gross_amount`
- `net_amount`
- `discount_amount`
- `tax_amount`
- `paid_at`
- `event_time`
- `event_type`
- `event_idempotency_key`
- `referral_code`
- `attributed_agent_user_id`
- `attribution_snapshot`
- `metadata`
- `created_at`
- `updated_at`

建议约束：

- `event_idempotency_key` 唯一
- `provider + provider_order_id` 唯一

说明：

- `provider` 要从一开始就设计成可扩展字段
- 推荐值至少包括：`creem`、`wechat_pay`、`alipay`
- `after_sales_status` 用来承接支付成功后的售后演进，不把“退款”直接塞进订单主状态里

#### `sales_order_item`

职责：订单项明细。

建议字段：

- `id`
- `order_id`
- `product_type`
- `product_id`
- `price_id`
- `plan_id`
- `quantity`
- `gross_amount`
- `net_amount`
- `commission_base_amount`
- `refunded_amount`
- `refundable_amount`
- `period_key`
- `metadata`

说明：

- 订阅首购、订阅续费、积分包购买都统一落成 item
- `commission_base_amount` 是真正用于分润的金额
- `period_key` 用于续费期幂等
- `refunded_amount` 用于支持部分退款或部分退货后的分润重算

#### `sales_after_sales_event`

职责：统一记录售后事件，不管来源是退款、退货、部分退款还是拒付。

建议字段：

- `id`
- `order_id`
- `order_item_id`
- `provider`
- `provider_after_sales_id`
- `after_sales_type`
- `status`
- `amount`
- `currency`
- `reason`
- `raw_payload`
- `event_idempotency_key`
- `occurred_at`
- `created_at`

建议 `after_sales_type`：

- `refund`
- `partial_refund`
- `return`
- `chargeback`
- `payment_reversal`

建议 `status`：

- `pending`
- `confirmed`
- `rejected`
- `closed`

说明：

- 对数字产品而言，大多数场景其实是退款，不一定是真实“退货”
- 但模型层要预留 `return`，避免未来商品形态变化后再推翻

### 6.3 规则与事件

#### `commission_rule`

职责：分润规则配置。

建议字段：

- `id`
- `status`
- `scope`
- `order_type`
- `product_type`
- `plan_id`
- `agent_level`
- `commission_level`
- `calculation_mode`
- `rate`
- `fixed_amount`
- `self_commission_enabled`
- `applies_to_first_purchase`
- `applies_to_renewal`
- `applies_to_credit_package`
- `freeze_days`
- `priority`
- `effective_from`
- `effective_to`
- `created_at`
- `updated_at`

说明：

- V1 可以先简化成：
  - 按 `order_type/product_type/commission_level`
  - 不做 `member_type/member_rank`
- 但字段先留好，避免后面推翻

#### `commission_event`

职责：一次订单触发的一次分润执行。

建议字段：

- `id`
- `order_id`
- `order_item_id`
- `trigger_user_id`
- `trigger_type`
- `status`
- `currency`
- `commission_base_amount`
- `settlement_basis`
- `rule_snapshot`
- `attribution_snapshot`
- `error_message`
- `executed_at`
- `created_at`

建议约束：

- `order_item_id + trigger_type` 唯一

#### `commission_record`

职责：某次事件对某个代理生成的一条分润明细。

建议字段：

- `id`
- `event_id`
- `beneficiary_user_id`
- `source_agent_user_id`
- `commission_level`
- `rule_id`
- `rule_snapshot`
- `amount`
- `currency`
- `status`
- `available_at`
- `reversed_at`
- `reversal_reason`
- `metadata`
- `created_at`

状态建议：

- `frozen`
- `available`
- `reversed`
- `withdrawn`

### 6.4 佣金总账与流水

#### `commission_balance`

职责：代理佣金余额快照。

建议字段：

- `user_id`
- `currency`
- `total_earned`
- `available_amount`
- `frozen_amount`
- `withdrawn_amount`
- `reversed_amount`
- `updated_at`

#### `commission_ledger`

职责：佣金账本流水。

建议字段：

- `id`
- `user_id`
- `record_id`
- `entry_type`
- `direction`
- `amount`
- `before_balance`
- `after_balance`
- `reference_type`
- `reference_id`
- `memo`
- `created_at`

`entry_type` 建议至少包括：

- `commission_frozen`
- `commission_available`
- `commission_reverse`
- `withdraw_freeze`
- `withdraw_release`
- `withdraw_paid`
- `manual_adjustment`

### 6.5 提现

#### `withdrawal_request`

职责：提现申请与审核。

建议字段：

- `id`
- `user_id`
- `amount`
- `fee_amount`
- `net_amount`
- `currency`
- `status`
- `payee_snapshot`
- `operator_user_id`
- `operator_note`
- `reviewed_at`
- `paid_at`
- `created_at`
- `updated_at`

状态建议：

- `pending`
- `approved`
- `rejected`
- `paid`
- `failed`


## 7. 业务主链路设计

### 7.1 Referral 捕获与绑定

入口：

- 落地页 URL 参数
- 邀请码输入
- 注册后首次绑定

流程：

1. 解析 `ref`、`campaign` 等参数
2. 校验 referral code 是否有效
3. 写入 cookie 或 server session
4. 如果用户已登录且未绑定代理，则写 `distribution_attribution`
5. 下次创建 Checkout 时读取当前有效归因

绑定规则建议：

- 默认首次有效代理锁定 30 天
- 首购后归属代理固定
- 续费默认跟随首购订单归属
- 管理员可手动改绑，但必须留审计日志

### 7.2 Checkout 创建

订阅入口：`src/features/payment/actions.ts`

积分入口：`src/features/credits/actions.ts`

都要补同一件事：

1. 读取当前用户有效归因
2. 生成 `checkout_context`
3. 把以下字段写入 Creem metadata：
   - `userId`
   - `checkoutType`
   - `productType`
   - `planId/packageId`
   - `referralCode`
   - `attributedAgentUserId`
   - `attributionId`
   - `clientOrderKey`

这里的核心目标不是“多传几个字段”，而是：

- 让 webhook 收到事件时，不需要再临时猜归因

### 7.3 Webhook 统一落订单

`src/app/api/webhooks/creem/route.ts` 需要改成“先归一订单，再做领域副作用”。

推荐顺序：

1. 验签
2. 生成 `event_idempotency_key`
3. 判断是否已经处理过
4. 标准化成内部 `SalesOrderPayload`
5. upsert `sales_order`
6. upsert `sales_order_item`
7. 执行订单后续副作用
8. 发 `commission_event`

副作用分两类：

- 订阅域副作用：
  - 创建或更新 `subscription`
  - 发订阅积分
- 积分域副作用：
  - 购买积分时调用 `grantCredits`

后续如果接微信支付或支付宝，不应复制一套分销逻辑，而应改成：

1. 各支付渠道各自完成验签和原始事件解析
2. 统一转换为内部 `PaymentOrderPayload`
3. 统一调用订单入库服务
4. 统一触发分销、积分、订阅副作用

也就是说：

- `CreemWebhookHandler`
- `WechatPayWebhookHandler`
- `AlipayWebhookHandler`

只负责“翻译”

真正的领域逻辑要进入统一服务，例如：

- `upsertSalesOrderFromPaymentEvent`
- `applySubscriptionOrderEffects`
- `applyCreditsOrderEffects`
- `triggerCommissionForOrder`

### 7.4 分润计算

流程应参考 `guns-distribution` 的“事件 -> 明细 -> 账本”，但做成 `tripsass` 风格。

推荐顺序：

1. 读取订单项和归因快照
2. 组装祖先链
3. 对每一级代理匹配 `commission_rule`
4. 生成 `commission_record`
5. 写 `commission_ledger` 的 `commission_frozen`
6. 累加 `commission_balance.frozen_amount`

### 7.5 佣金解冻

不要在支付成功当天直接变可提现。

建议：

- 默认冻结 7 到 14 天
- 到期后批任务把 `frozen -> available`

流程：

1. 扫描 `commission_record.status = frozen and available_at <= now`
2. 批量改为 `available`
3. 写账本 `commission_available`
4. 更新 `commission_balance`

### 7.6 退款、退货与冲正

这是当前文档里必须补重的一段。

订单退款、退货或拒付后：

1. 找到对应 `sales_order` / `sales_order_item`
2. 写入 `sales_after_sales_event`
3. 更新订单 `after_sales_status`
4. 计算本次售后实际影响金额
5. 找到所有相关 `commission_record`
6. 生成冲正动作
7. 写账本 `commission_reverse`
8. 更新 `commission_balance`

### 7.6.1 售后状态建议

建议把订单主状态与售后状态拆开：

- 订单主状态只表示是否支付成功、是否已确认
- 售后状态表示支付成功之后又发生了什么

建议 `sales_order.status`：

- `pending`
- `paid`
- `confirmed`
- `closed`

建议 `sales_order.after_sales_status`：

- `none`
- `partial_refund`
- `refunded`
- `returned`
- `chargeback`

这样做的原因是：

- 订单可以先成功完成
- 后面再发生退款或拒付
- 分销、订阅、积分、账本都需要知道“这是成功订单上的售后”，而不是把订单主状态直接改坏

### 7.6.2 退货、退款、拒付的处理差异

建议统一处理，但保留差异字段。

#### 退款

典型场景：

- 用户主动申请退款
- 管理员手动全额退款
- 部分退款

处理重点：

- 以实际退款金额为准冲减 `commission_base_amount`

#### 退货

如果后续有实体商品或可撤销权益，可视为一种特殊售后：

- 先记录 `return`
- 退货完成后，如果对应支付同步退款，再生成 `refund` 或直接标记 `confirmed`

对当前 `tripsass` 来说，大多数是数字商品，实际更常见的是：

- 退款
- 撤销权益
- 拒付

因此 V1 可以先按“退款型售后”实现，但数据模型要兼容 `return`

进一步收敛成实现边界就是：

- 如果当前售卖的仍然是数字订阅和积分包，V1 主流程只实现 `refund`、`partial_refund`、`chargeback`
- `return` 先作为 `after_sales_type` 保留，不急着做独立页面和独立状态机
- 只有后续真的出现实体商品、卡券寄送或需要“先退货再退款”的权益时，再把 `return` 从预留字段升级为完整流程

#### 拒付 / Chargeback

这类场景必须单独保留类型，不能和普通退款混用。

原因：

- 通常是支付渠道强制逆转
- 可能发生在佣金已经可提现甚至已经提现之后
- 风控和财务追责口径不同

### 7.6.3 部分退款的分润重算

如果是部分退款，不建议简单把整笔佣金全冲掉。

建议规则：

1. 先确定订单项原始 `commission_base_amount`
2. 根据累计退款金额计算剩余可结算金额
3. 用“应得佣金 - 已记佣金”得到本次冲正额

这样可以支持：

- 多次部分退款
- 部分退货
- 一笔订单项多次售后

### 7.6.4 与积分和订阅副作用的联动

退款或退货不仅影响佣金，也要影响主业务权益。

至少要定义以下联动规则：

- 积分包退款：
  - 如果积分尚未消费，可直接回收对应 batch
  - 如果已消费，需转为负债或限制退款策略
- 订阅退款：
  - 需要决定是否立即终止权益，或保留到周期结束
- 分销佣金：
  - 始终按实际入账净收入重新计算

不能只做佣金冲正，不处理主业务权益，否则账会对不上

### 7.6.5 冲正规则建议

建议把规则写死到文档里，开发时不要临时拍脑袋：

- `frozen` 佣金：直接冲回冻结额
- `available` 佣金：扣减可用余额
- `withdrawn` 佣金：记为代理应收欠款或负余额，不自动抹平
- 多次部分退款：按差额重复冲正，不允许重复全冲
- 拒付：允许带风险标记，优先进入风控队列

处理原则建议：

- `frozen` 佣金：直接冲回
- `available` 佣金：扣减可用余额
- `withdrawn` 佣金：记为应收或负余额，不自动抹平

### 7.6.6 幂等要求

每一条售后事件都必须有独立 `event_idempotency_key`。

不论来源是：

- Creem refund webhook
- 微信支付退款通知
- 支付宝退款通知
- 管理员手动退款

都要先归一成同一类售后事件再处理，避免重复冲正

### 7.6.7 多支付渠道下的售后统一

后续接入微信支付、支付宝时，这一层尤为关键。

正确做法：

- 上游各支付渠道各自解析“退款成功”“部分退款”“关闭交易”“拒付”
- 下游统一映射成 `sales_after_sales_event`

这样分销域不会感知：

- 这是 Creem 的 refund webhook
- 还是微信支付的退款回调
- 还是支付宝的退款通知

它只感知：

- 哪个订单项被售后
- 售后类型是什么
- 金额是多少
- 是否已经确认

### 7.8 多支付提供商接入方案

这部分是为了保证后面接微信支付、支付宝时改动足够小。

#### 7.8.1 抽象边界

建议把支付系统拆成三层：

1. 支付渠道适配层
2. 内部支付订单标准层
3. 业务副作用层

其中：

- 支付渠道适配层负责：
  - 下单参数转换
  - 签名验证
  - 原始 webhook 解析
- 内部支付订单标准层负责：
  - 标准化 `PaymentOrderPayload`
  - 标准化 `AfterSalesPayload`
- 业务副作用层负责：
  - 订单落库
  - 订阅更新
  - 积分发放
  - 分销分润
  - 冲正

#### 7.8.2 建议接口

可以在设计上预留统一接口，例如：

- `createPaymentCheckout(input)`
- `normalizePaymentEvent(input)`
- `normalizeAfterSalesEvent(input)`
- `upsertSalesOrderFromPaymentEvent(payload)`
- `recordAfterSalesEvent(payload)`

这样后面新增支付渠道时，主要增加的是适配器，而不是重写业务域。

#### 7.8.3 `provider` 相关字段设计原则

所有和支付渠道有关的字段都应该在订单域里抽象，不要散落在分销域：

- `provider`
- `provider_order_id`
- `provider_checkout_id`
- `provider_payment_id`
- `provider_subscription_id`
- `provider_customer_id`
- `raw_payload`

分销域只通过订单域读取统一结果。

#### 7.8.4 用户与支付渠道的关系

无论接 Creem、微信支付还是支付宝，都继续复用现有用户体系：

- 一个 `user`
- 可以关联多个支付渠道客户标识
- 可以有多笔来自不同支付渠道的订单
- 但只有一个分销身份与一个佣金账户

如果确实需要保存支付渠道侧的账户映射，建议新增类似：

- `payment_customer_profile`

字段示例：

- `user_id`
- `provider`
- `provider_customer_id`
- `provider_open_id`
- `provider_union_id`
- `created_at`
- `updated_at`

这张表只是支付渠道映射表，不是第二套账号体系。

#### 7.8.5 后续接入微信支付、支付宝时哪些层需要改

如果前面这套边界守住，后续新增支付渠道时，真正需要改动的范围应当很小。

主要改动点：

1. 新增支付渠道配置项与签名参数
2. 新增 `createPaymentCheckout` 对应 provider 的下单实现
3. 新增该 provider 的 webhook 验签和事件标准化
4. 在 `payment_customer_profile` 中记录该渠道客户标识

原则上不应大改的部分：

1. `distribution_*`
2. `commission_*`
3. `withdrawal_*`
4. `sales_*` 的核心状态机
5. 现有 `user` 账号体系

也就是说，未来接微信支付或支付宝时，理想结果应该是：

- 新增适配器文件
- 补几类 provider 枚举和值映射
- 补 webhook 测试

而不是重写分销逻辑、重做订单模型或拆账号。

### 7.7 提现

提现流程直接参考 `guns-distribution` 的状态机，但把“打款模拟”换成真实外部接口占位。

流程：

1. 用户发起提现
2. 冻结可用佣金
3. 后台审核
4. 审核拒绝则解冻
5. 审核通过后发起外部打款
6. 打款成功记 `withdraw_paid`
7. 打款失败记 `withdraw_release`


## 8. tripsass 与 guns-distribution 的映射关系

| guns-distribution | tripsass 目标对象 | 说明 |
| --- | --- | --- |
| `dist_member` | `distribution_profile` | 都表示代理关系树 |
| `dist_account` | `commission_balance` | 只保留佣金，不混积分 |
| `dist_account_record` | `commission_ledger` | 都是账本流水 |
| `dist_profit_param` | `commission_rule` | 规则配置 |
| `dist_profit_event` | `commission_event` | 触发事件 |
| `dist_profit_record` | `commission_record` | 分润明细 |
| `dist_withdraw_record` | `withdrawal_request` | 提现申请 |
| `dist_rank_param` | `agent_level_rule` 或暂缓 | V1 不一定要做 |
| `TradeGoodsEvent` | `sales_order` 驱动事件 | 改成订单中心触发 |
| `InviteMemberEvent` | referral 绑定奖励事件 | 可作为后续阶段 |
| 无 | `sales_after_sales_event` | `tripsass` 必须新增，用于统一售后与冲正 |


## 9. 推荐实现边界

为了保证“不是半成品”，但也不把范围拉爆，建议按下面边界做 V1。

### 9.1 V1 必做

1. 推广码和推广链接归因
2. 订阅首购分佣
3. 订阅续费分佣
4. 积分包购买分佣
5. 多级代理分佣
6. 佣金冻结与可用化
7. 提现申请、审核、打款、拒绝
8. 退款、部分退款、拒付驱动的佣金冲正
9. 后台规则配置和订单追溯
10. 支付渠道抽象，保证后续接微信支付、支付宝时不推翻现有设计
11. 每阶段都有自动验证

### 9.2 V1 暂不做

1. 类似 `guns-distribution` 的会员积分段位分润
2. 自购返佣默认关闭
3. 复杂渠道结算和线下代理签约
4. 月度业绩奖池

### 9.3 V1 预留字段但不马上启用

1. `agent_level`
2. `self_commission_enabled`
3. `campaign`
4. `landing_path`
5. `manual_adjustment`
6. `return` 型售后完整流程
7. `wechat_pay`、`alipay` provider 适配器
8. `payment_customer_profile.provider_open_id`
9. `payment_customer_profile.provider_union_id`


## 10. 分阶段开发与验证计划

下面这部分是后续开发的执行顺序。规则只有一条：

- 当前阶段验证通过，才进入下一阶段

### 阶段 0：领域建模与迁移

目标：

- 新增 `distribution_*`、`sales_*`、`commission_*`、`withdrawal_*` 表
- 新增 `sales_after_sales_event`
- 不改现有支付行为

产出：

- Drizzle schema
- migration
- 基础类型与 service skeleton

验证：

1. `pnpm typecheck`
2. `pnpm test:run` 至少跑 DB 相关基础测试
3. migration 在测试库可执行、可回滚

通过标准：

- 所有新表可以正常建表
- 现有订阅与积分测试不回归

### 阶段 1：Referral 捕获与绑定

目标：

- 支持推广链接、邀请码、归因绑定

产出：

- `distribution_referral_code`
- `distribution_attribution`
- 前台 referral 解析与持久化
- Checkout 前归因读取

验证：

1. 访问带 `ref` 参数页面，归因写入 cookie/session
2. 登录后完成绑定，数据库写入 attribution
3. 同一用户重复进入不同推广链接时，锁定规则正确
4. 补充单测与集成测试

通过标准：

- Checkout 前能稳定拿到代理归因

当前进度更新：

- 本阶段已经开始落地
- 已完成内容：
  1. 已新增 `distribution_profile`、`distribution_referral_code`、`distribution_attribution`
  2. middleware 已开始捕获 URL 中的 `ref`、`campaign` 并写入 Cookie
  3. Checkout 创建前已经开始读取归因上下文，并把归因字段写入支付 metadata
  4. 已补充归因测试，覆盖 cookie 编解码、推广参数提取、归因绑定与复用
- 当前还未完成内容：
  1. 邀请码输入绑定页面
  2. 管理端推广码生成和维护
  3. 归因改绑审计
  4. referral 与统一订单的显式字段关联

本轮验证结果：

1. `pnpm typecheck` 通过
2. `pnpm exec vitest run src/test/distribution/attribution.test.ts` 通过
3. `pnpm exec vitest run src/test/payment/webhook.test.ts src/test/credits/purchase.test.ts src/test/distribution/attribution.test.ts` 通过

### 阶段 2：统一订单中心

目标：

- 把支付 webhook 统一落成订单，并为多支付渠道预留标准化入口

产出：

- `sales_order`
- `sales_order_item`
- webhook idempotency
- `PaymentOrderPayload` 标准模型
- 订阅首购、续费、积分包统一归一

验证：

1. `checkout.completed` 订阅首购创建订单
2. `subscription.active` / `subscription.renewed` 正确更新订单状态
3. 积分包支付完成后创建订单并发放积分
4. 同一 webhook 重放不会重复落订单
5. 现有 webhook 测试补齐真实分支

通过标准：

- 订阅和积分包都能进入统一订单表
- 换支付提供商时，只需要新增适配层，不需要改分销核心逻辑

当前进度更新：

- 本阶段已经开始落地，不再只是前置准备
- 已完成内容：
  1. `credit_purchase` 在 `checkout.completed` 中真实发放积分
  2. 同一笔积分购买补了幂等校验
  3. 已新增 `sales_order` / `sales_order_item` 最小表结构
  4. `checkout.completed` 已开始落统一订单，覆盖订阅和积分包
  5. 已抽出统一订单服务层，Checkout 和订阅生命周期事件开始复用同一套落单逻辑
  6. `subscription.active` 会确认首购订单，`subscription.renewed` 会生成续费订单
  7. 续费事件已补幂等，重复 `subscription.renewed` 不会重复创建续费订单
  8. 已新增标准化 `PaymentOrderPayload`，Webhook 到订单域的映射开始统一
  9. `sales_order` 已显式写入 `referral_code`、`attributed_agent_user_id`、`attribution_id`、`attribution_snapshot`
  10. 已新增 `sales_after_sales_event`，退款、全额退款、退货、拒付开始统一入事件表
  11. 售后事件会同步回写 `sales_order.after_sales_status` 和订单项退款金额
  12. Webhook 测试改成走真实处理逻辑，不再只测手写模拟逻辑
  13. 测试数据库连接逻辑已修正，兼容 Neon 和标准 PostgreSQL
- 当前还未完成内容：
  1. 支付渠道原生退款/拒付 webhook 接入
  2. 多支付渠道标准化适配层
  3. 订单金额字段的进一步细化
  4. 续费金额从支付侧事件回填
  5. 分润冻结与退款冲正联动

本轮验证结果：

1. `pnpm typecheck` 通过
2. `pnpm exec vitest run src/test/payment/webhook.test.ts` 通过
3. `pnpm exec vitest run src/test/credits/purchase.test.ts` 通过
4. `pnpm exec vitest run src/test/distribution/attribution.test.ts` 通过
5. `pnpm db:generate` 与 `pnpm exec drizzle-kit push --force` 已完成

### 阶段 3：佣金引擎

目标：

- 订单确认后自动产出佣金记录

产出：

- `commission_rule`
- `commission_event`
- `commission_record`
- `commission_balance`
- `commission_ledger`

验证：

1. 一级代理分佣
2. 二级代理分佣
3. 三级代理分佣
4. 首购和续费按不同规则命中
5. 积分包按单次购买规则命中
6. 重放同一订单不重复记佣金

通过标准：

- 每条佣金都能追溯到订单项、规则快照、代理层级

当前进度更新：

- 本阶段已经开始落地，不再停留在表设计
- 已完成内容：
  1. 已新增 `commission_rule`、`commission_event`、`commission_record`、`commission_balance`、`commission_ledger`
  2. 当前已经支持首版一级代理分佣，入口挂在统一订单主链上
  3. 有归因的积分包订单在支付成功后会生成冻结佣金、余额快照和账本流水
  4. 同一订单项 + 同一触发类型补了幂等，重复 webhook 不会重复记佣金
  5. 佣金规则当前支持最小字段：订单类型、商品类型、百分比/固定金额、冻结天数、首购/续费/积分包开关
- 当前还未完成内容：
  1. 二级、三级代理分佣
  2. 订阅首购和续费的差异化规则覆盖
  3. 规则后台管理
  4. 退款、拒付驱动的佣金冲正
  5. 佣金解冻任务

本轮验证结果：

1. `pnpm typecheck` 通过
2. `pnpm exec vitest run src/test/payment/webhook.test.ts src/test/credits/purchase.test.ts src/test/distribution/attribution.test.ts` 通过
3. `pnpm db:generate` 与 `pnpm exec drizzle-kit push --force` 已完成

Review 补充：

- 这轮回看 `guns-distribution` 的分润链路后，确认当前 tripsass 里有一个真实缺口：
  - 售后事件已经会回写订单
  - 但原本不会回冲已冻结佣金
  - 这会导致“订单退款了，但代理冻结佣金还挂着”的错账
- 当前已补上这一点：
  1. `sales_after_sales_event` 入账后，会按退款比例回冲对应佣金
  2. 部分退款按比例扣减冻结佣金
  3. 全额退款会把佣金记录标记为 `reversed`
  4. 同时写入 `commission_ledger.commission_reverse`
- 当前已经继续补到可用余额阶段：
  1. 已支持按 `available_at` 解冻佣金
  2. 已支持 `frozen -> available` 的余额迁移和账本流水
  3. 已支持 `available` 佣金在退款后回扣可用余额
- 已提现佣金、负债场景仍然属于后续阶段

### 阶段 4：冻结、解冻、退款冲正

目标：

- 让佣金真正进入可运营状态

产出：

- 解冻批任务
- 退款冲正服务
- 售后事件表与处理器
- 冲正账本流水

验证：

1. 冻结期到达后自动转可用
2. `frozen` 佣金退款后正确冲回
3. `available` 佣金退款后正确扣减
4. 已提现佣金退款后记负债或负余额
5. 部分退款按差额冲正
6. 售后事件重复通知不会重复冲正

通过标准：

- 账本始终平衡，余额不失真

当前进度更新：

- 本阶段已经开始落地
- 已完成内容：
  1. 已新增统一售后事件表和订单回写
  2. 已支持冻结佣金在退款后按比例冲正
  3. 已支持全额退款把佣金记录标记为 `reversed`
  4. 已支持 `available_at` 到期后将佣金从冻结转为可用
  5. 已支持 `available` 佣金在退款后扣减可用余额
  6. 已补充冻结、解冻、冻结冲正、可用冲正测试
- 当前还未完成内容：
  1. 已提现佣金退款后的负债处理
  2. 后台定时任务或 Cron 入口
  3. 原生支付渠道售后 webhook 接入
  4. 代理人工调账

本轮验证结果：

1. `pnpm typecheck` 通过
2. `pnpm exec vitest run src/test/payment/webhook.test.ts src/test/credits/purchase.test.ts src/test/distribution/attribution.test.ts` 通过

### 阶段 5：提现与后台

目标：

- 提供代理中心和后台审核能力

产出：

- 代理端佣金页、订单页、提现页
- 后台规则配置页
- 后台订单追溯页
- 后台提现审核页

验证：

1. 用户提交提现申请后，可用余额减少、冻结余额增加
2. 审核拒绝后正确解冻
3. 审核通过并确认打款后，冻结金额转已提现
4. 后台能查每笔佣金命中哪条规则

通过标准：

- 从“推广进入 -> 支付成功 -> 佣金到账 -> 提现完成”全链路可手动走通

当前进度更新：

- 本阶段已经开始落地，但当前只覆盖提现后端，不含页面
- 已完成内容：
  1. 已新增 `withdrawal_request`
  2. 已支持创建提现申请
  3. 已支持拒绝提现后释放冻结余额
  4. 已支持确认打款后增加 `withdrawn_amount`
  5. 已支持对应 `withdraw_freeze`、`withdraw_release`、`withdraw_paid` 账本流水
  6. 已补充提现申请、拒绝、打款测试
- 当前还未完成内容：
  1. 代理端提现页面
  2. 后台审核页面
  3. 审批权限控制
  4. 提现手续费规则配置
  5. 已提现后退款负债联动

前端进度补充：

- 当前已经补上用户端 `dashboard/distribution` 页面
- 页面已展示代理资料、推广码、归因订单、佣金记录、提现记录
- 页面已接入提现申请表单，直接复用现有 `withdrawal_request` 后端状态机
- Dashboard 侧边栏已补上分销入口
- 已补充前端展示和提现提交流程测试
- 当前仍缺后台审核页面和管理入口，本阶段下一步继续补管理端

本轮验证结果：

1. `pnpm typecheck` 通过
2. `pnpm exec vitest run src/test/distribution/withdrawal.test.ts src/test/payment/webhook.test.ts src/test/credits/purchase.test.ts src/test/distribution/attribution.test.ts` 通过
3. `pnpm db:generate` 与 `pnpm exec drizzle-kit push --force` 已完成


## 11. 测试矩阵

为了避免继续做成半成品，测试至少要覆盖这些场景。

### 11.1 归因

- 首次 referral 绑定
- 锁定期内重复访问其他 referral
- 登录前进入、登录后下单
- 同设备未登录用户多次访问

### 11.2 订单

- 订阅首购
- 订阅续费
- 订阅取消但周期未结束
- 积分包购买
- Webhook 重放
- 不同 `provider` 的标准化落单

### 11.3 分润

- 一级、二级、三级
- 无上级
- 规则缺失
- 规则失效时间
- 首购和续费不同费率

### 11.4 冲正

- 冻结中退款
- 可用后退款
- 提现后退款
- 部分退款
- 拒付
- 售后重复通知

### 11.5 多支付渠道

- Creem 下单与 webhook
- 微信支付下单参数映射
- 支付宝下单参数映射
- 多 provider 订单统一关联到同一 `user_id`
- 同一用户不同支付渠道订单都能进入同一分销体系

### 11.6 提现

- 金额不足
- 审核拒绝
- 审核通过
- 打款失败回滚


## 12. 开发落点建议

建议新增模块结构如下：

```text
src/features/distribution/
├── actions/
├── attribution/
├── orders/
├── commission/
├── ledger/
├── settlements/
├── withdrawals/
├── admin/
└── types/
```

职责建议：

- `attribution`：推广码、链接、cookie/session、绑定
- `orders`：Webhook 标准化、统一订单落库、幂等
- `commission`：规则命中、分润事件、分润明细
- `ledger`：余额与流水
- `settlements`：冻结、解冻、冲正、重放
- `withdrawals`：提现申请与审核
- `admin`：后台配置和追溯


## 13. 最终落地结论

参考 `guns-distribution` 做 `tripsass` 分销，正确的参考方式不是照抄表名和 Java 结构，而是照抄它的业务骨架：

- 先有代理关系
- 再有分润规则
- 再有事件
- 再有明细
- 再有账本
- 最后接提现和后台

`tripsass` 当前最需要先补的不是页面，而是三件基础设施：

1. 统一订单中心
2. 分销归因模型
3. 独立佣金账本

再补两条落地约束：

1. 退货在当前阶段先按“售后类型预留”处理，不把范围提前做重
2. 微信支付、支付宝未来只增加支付适配层和渠道映射，不拆第二套用户账号体系

只要这三块落稳，后面的：

- 订阅首购分佣
- 续费分佣
- 积分包分佣
- 多级代理分佣
- 冻结解冻
- 提现审核
- 退款冲正
- 退货/售后事件处理
- 微信支付/支付宝接入

都能沿着同一条主线做下去，而且每个阶段都能独立验证。

当前代码进度补充：

1. 方案文档里点名的 `credit_purchase` 断点已经补齐第一步
2. 当前已经具备“积分包支付完成后真实发积分”和“重复 webhook 不重复发积分”
3. 当前已经具备统一订单最小骨架，`checkout.completed` 会为订阅和积分包写入 `sales_order` / `sales_order_item`
4. 当前已经补上统一订单服务层，`subscription.active` 和 `subscription.renewed` 也会进入统一订单域
5. 当前已经补上 `PaymentOrderPayload` 和订单显式归因字段，后续分润不需要再从 metadata 反查
6. 当前已经补上 `sales_after_sales_event` 和订单退款回写，退货和拒付也有统一入口
7. 当前已经补上佣金事件、佣金记录、冻结余额和佣金账本，积分包分佣可以闭环
8. 当前已经补上退款驱动的冻结佣金冲正，至少不会出现“退款后冻结佣金不回退”的错账
9. 当前已经补上佣金解冻、可用佣金冲正和最小提现后端
10. 当前已经补上用户端分销中心页面和提现申请界面
11. 当前还缺后台审核页、已提现负债处理和多支付渠道接入
12. 下一步应继续推进后台页面与管理能力，而不是继续堆底层表
