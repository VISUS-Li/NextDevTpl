# 微信支付宝接入方案分析

## 目标

本文先分析 `go-pay/gopay` 的支付设计，再分析当前项目已有的支付链路，最后给出一套适配当前项目的微信支付、支付宝接入方案。

目标不是推翻现有 `Creem + webhook + 统一订单 + 积分发放 + 分销归因` 链路，而是在尽量少改动现有业务核心的前提下，把国内常用支付方式接进来。

## 当前进度

### 阶段 1 已完成

- 已新增 `payment_intent` 表，作为本地待支付单
- 已新增统一积分购买创建服务，支持 `creem`、`wechat_pay`、`alipay`
- 已新增接口：
  - `POST /api/platform/payment/credit-purchase`
  - `GET /api/platform/payment/intents/[intentId]`
- 已把积分购买页改成先选支付方式，再创建支付单
- 已新增站内收银台页 `/dashboard/credits/buy/checkout?intentId=...`
- 已补齐第一阶段接口测试，使用模拟支付模式验证“创建支付单”和“读取支付单”链路

### 阶段 1 验证

- `psql "$DATABASE_URL" -f drizzle/0016_quick_payment_intent.sql`
- `pnpm exec biome check --write ...`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/credit-purchase-phase1.test.ts --reporter=dot`

### 下一阶段

- 阶段 2：接微信支付和支付宝 webhook 验签、回写支付成功状态、统一订单落单、积分发放与分销结算

### 阶段 2 已完成

- 已新增 webhook：
  - `POST /api/webhooks/wechat-pay`
  - `POST /api/webhooks/alipay`
- 已新增统一支付成功处理器，打通：
  - `payment_intent.status=paid`
  - `sales_order / sales_order_item`
  - `creditsBatch / grantCredits`
  - `settleCommissionForSalesOrder`
- 已补齐微信、支付宝回调接口测试，覆盖：
  - 微信回调成功入账
  - 支付宝重复回调幂等

### 阶段 2 验证

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/payment-webhook-phase2.test.ts --reporter=dot`

### 最后阶段

- 阶段 3：补充支付配置入口、最终验收测试和使用说明，让当前积分购买链路达到可直接配置使用的完成态

### 阶段 3 已完成

- 已把微信支付、支付宝和 `PAYMENT_MOCK_MODE` 所需环境变量写入 `.env.example`
- 已补充最终验收测试，覆盖“创建支付单 -> 模拟支付成功回调 -> 重新读取支付状态”
- 当前实现范围已经达到“积分包购买可直接配置使用”的完成态

### 阶段 3 验证

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/payment-phase3-acceptance.test.ts --reporter=dot`

### 阶段 4 已完成

- 已新增管理员支付查询接口：
  - `GET /api/platform/payments/admin`
  - `GET /api/platform/payments/admin/[orderId]`
- 已新增后台支付中心页：
  - `/admin/payments`
- 已把 `payment_intent`、`sales_order`、`sales_order_item`、`sales_after_sales_event` 串成统一详情视图
- 已支持按用户邮箱、订单号、渠道单号、支付方式和订单类型筛选
- 已补齐阶段 4 接口测试，覆盖：
  - 普通用户创建并支付成功
  - 管理员按接口方式查询支付列表
  - 管理员读取单笔支付详情

### 阶段 4 验证

- `pnpm exec biome check src/features/payment/admin.ts src/app/api/platform/payments/admin/route.ts src/app/api/platform/payments/admin/[orderId]/route.ts src/features/payment/components/admin-payment-view.tsx src/app/[locale]/(admin)/admin/payments/page.tsx src/config/nav.ts src/test/payment/admin-payment-phase4.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/admin-payment-phase4.test.ts --reporter=dot`

### 阶段 5 已完成

- 已新增管理员退款接口：
  - `POST /api/platform/payments/admin/refund`
- 已新增 `src/features/payment/refund-service.ts`，统一处理：
  - 渠道退款请求
  - 积分回收
  - `sales_after_sales_event` 落库
  - 全额退款后的 `payment_intent.status=refunded`
- 已把后台支付详情页接上退款表单
- 当前阶段退款范围先收口为：
  - 积分包订单
  - 用户当前余额足够回收对应积分时才允许退款
- 已补齐阶段 5 接口测试，覆盖：
  - 用户支付成功
  - 管理员发起全额退款
  - 订单、支付单、积分余额和售后事件同步回写

### 阶段 5 验证

- `pnpm exec biome check src/features/payment/refund-service.ts src/app/api/platform/payments/admin/refund/route.ts src/features/payment/components/admin-payment-view.tsx src/test/payment/admin-payment-phase5-refund.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/admin-payment-phase5-refund.test.ts --reporter=dot`

### 阶段 6 已完成

- 已新增 `subscription_contract / subscription_billing` 表，专门承接连续扣费签约与周期账单
- 已新增连续扣费服务 `src/features/payment/subscription-recurring.ts`
- 已新增微信连续扣费接口：
  - `POST /api/platform/payment/subscription/contracts`
  - `GET /api/platform/payment/subscription/contracts/[contractId]`
  - `POST /api/platform/payment/subscription/contracts/[contractId]/bill`
  - `POST /api/webhooks/wechat-pay/subscription-contract`
  - `POST /api/webhooks/wechat-pay/subscription-billing`
- 已打通签约激活、首期账单生成、账单成功回调、订阅状态回写、统一订单落单、订阅积分发放与分销结算
- 当前微信连续扣费阶段采用：
  - 站内协议模型 + 周期账单模型
  - 模拟签约与模拟扣款回调完成联调

### 阶段 6 验证

- `set -a; source .env.test; set +a; psql "$DATABASE_URL" -f drizzle/0017_swift_agreement.sql`
- `pnpm exec biome check src/db/schema.ts drizzle/meta/_journal.json src/test/utils/db.ts src/config/payment.ts src/features/payment/subscription-recurring.ts src/app/api/platform/payment/subscription/contracts/route.ts src/app/api/platform/payment/subscription/contracts/[contractId]/route.ts src/app/api/platform/payment/subscription/contracts/[contractId]/bill/route.ts src/app/api/webhooks/wechat-pay/subscription-contract/route.ts src/app/api/webhooks/wechat-pay/subscription-billing/route.ts src/test/payment/subscription-wechat-phase6.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/subscription-wechat-phase6.test.ts --reporter=dot`

### 阶段 7 已完成

- 已新增支付宝代扣订阅能力：
  - `POST /api/webhooks/alipay/subscription-contract`
  - `POST /api/webhooks/alipay/subscription-billing`
- 已新增用户侧自动续费管理页：
  - `/dashboard/subscription/auto-renew`
- 已支持当前用户在站内完成：
  - 创建微信连续扣费或支付宝代扣签约
  - 查看已有签约
  - 生成首期账单
  - 支付宝签约激活与账单回调入账
  - 主动解约
- 已把支付宝代扣继续复用现有 `subscription_contract + subscription_billing + sales_order` 模型，没有额外再长一套业务表
- 当前阶段在真实环境下：
  - 支付宝签约页使用 `alipay.user.agreement.page.sign`
  - 支付宝解约使用 `alipay.user.agreement.unsign`
  - 微信签约和账单仍沿用阶段 6 的站内协议模型
- 已补齐阶段 7 接口测试，覆盖：
  - 支付宝创建签约
  - 支付宝签约回调激活
  - 首期账单生成
  - 支付宝账单回调入账
  - 查询签约详情
  - 用户主动解约

### 阶段 7 验证

- `pnpm exec biome check src/features/payment/subscription-recurring.ts src/app/api/platform/payment/subscription/contracts/[contractId]/route.ts src/app/[locale]/(dashboard)/dashboard/subscription/auto-renew/page.tsx src/features/payment/components/auto-renew-contracts-view.tsx src/app/api/platform/payment/subscription/contracts/route.ts src/app/api/webhooks/alipay/subscription-contract/route.ts src/app/api/webhooks/alipay/subscription-billing/route.ts src/test/payment/subscription-alipay-phase7.test.ts src/config/nav.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/subscription-alipay-phase7.test.ts --reporter=dot`

### 阶段 8 已完成

- 已新增连续扣费渠道动作层：
  - `src/features/payment/recurring-provider-service.ts`
- 已新增连续扣费通知解析层：
  - `src/features/payment/recurring-provider-notify.ts`
- 已把 `subscription-recurring.ts` 中的签约链接生成、渠道解约逻辑迁移到渠道动作层
- 已把四个连续扣费 webhook 路由改成复用统一通知解析层，不再在路由文件里直接散落解析逻辑
- 当前阶段先完成结构拆分，为后续真实扣款、查约、验签和失败补偿继续叠加做准备
- 已补齐阶段 8 测试，覆盖：
  - mock 模式签约链接生成
  - mock 模式查约结果
  - mock 模式下微信、支付宝连续扣费回调解析

### 阶段 8 验证

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/subscription-provider-phase8.test.ts --reporter=dot`

### 阶段 9 已完成

- 已把连续扣费账单生成从“只写本地账单”推进到“本地账单 + 渠道发单”：
  - `src/features/payment/subscription-recurring.ts`
  - `src/features/payment/recurring-provider-service.ts`
- 已新增连续扣费定时任务入口：
  - `src/app/api/jobs/payment/subscription-recurring/route.ts`
- 当前手工 `/bill` 与定时任务已共用 `triggerSubscriptionBilling()`
- 已补上同一账期幂等判断，避免重复生成和重复发单
- 发单成功后会回写：
  - `providerOrderId`
  - `providerPaymentId`
  - `metadata.providerDispatch`
- 发单失败时会把账单标记为 `failed` 并记录失败原因
- 已补齐阶段 9 测试，覆盖：
  - 手工触发账单时回写渠道发单结果
  - 定时任务扫描到期协议并生成账单

### 阶段 9 验证

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/subscription-recurring-phase9.test.ts --reporter=dot`
- `pnpm test:run src/test/payment/subscription-wechat-phase6.test.ts src/test/payment/subscription-alipay-phase7.test.ts --reporter=dot`

### 阶段 10 已完成

- 已补齐连续扣费查约、查单、失败补偿和管理员排障入口：
  - `src/features/payment/recurring-provider-service.ts`
  - `src/features/payment/subscription-recurring.ts`
  - `src/features/payment/admin.ts`
- 已新增管理员同步与手工补扣接口：
  - `src/app/api/platform/payments/admin/subscriptions/contracts/[contractId]/sync/route.ts`
  - `src/app/api/platform/payments/admin/subscriptions/billings/[billingId]/sync/route.ts`
  - `src/app/api/platform/payments/admin/subscriptions/billings/[billingId]/retry/route.ts`
- 已把微信、支付宝连续扣费失败回调接入本地失败状态回写，不再直接返回报错
- 已补上“最近 3 期连续失败则暂停协议”的规则
- 已把支付中心详情页补齐订阅协议、周期账单、失败原因和渠道原始响应查看入口
- 已补齐阶段 10 测试，覆盖：
  - 连续失败 3 次后暂停协议
  - 管理员查看协议和账单排障详情
  - 管理员同步协议、同步账单、手工补扣失败账单

### 阶段 10 验证

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm test:run src/test/payment/subscription-admin-phase10.test.ts --reporter=dot`
- `pnpm test:run src/test/payment/admin-payment-phase4.test.ts src/test/payment/subscription-wechat-phase6.test.ts src/test/payment/subscription-alipay-phase7.test.ts src/test/payment/subscription-recurring-phase9.test.ts --reporter=dot`

## 使用前配置

### 1. 开发或联调用模拟模式

```env
PAYMENT_MOCK_MODE=true
```

此模式下：

- 创建支付单不会请求真实微信或支付宝
- 收银台会使用模拟跳转地址或模拟二维码链接
- 适合本地调 UI、接口、回调和积分入账

### 2. 微信支付正式配置

```env
WECHAT_PAY_MCH_ID=
WECHAT_PAY_SERIAL_NO=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_PRIVATE_KEY=
WECHAT_PAY_PUBLIC_KEY=
WECHAT_PAY_APP_ID=
```

回调地址默认使用：

- `https://你的域名/api/webhooks/wechat-pay`

### 3. 支付宝正式配置

```env
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
```

回调地址默认使用：

- `https://你的域名/api/webhooks/alipay`

### 4. 当前可直接使用的能力

- 用户在 `/dashboard/credits/buy` 选择支付方式
- 创建本地 `payment_intent`
- 进入站内收银台页
- 微信支付和支付宝异步回调成功后自动：
  - 回写 `payment_intent`
  - 落 `sales_order`
  - 发放积分
  - 结算分销佣金
- 管理员可在 `/admin/payments` 查看支付列表和单笔详情
- 管理员可在 `/admin/payments` 对积分包订单发起退款
- 用户可在 `/dashboard/subscription/auto-renew` 创建和查看自动续费签约
- 模拟模式下，已可完成微信连续扣费、支付宝代扣的签约、首期账单、回调入账和解约联调
- 真实环境下，支付宝签约页、解约、账单回调入账已接上；微信连续扣费和支付宝周期扣款还没有形成完整的生产闭环

### 5. 当前未纳入本轮范围

- 连续扣费真实周期扣款发起
- 连续扣费定时任务调度
- 连续扣费回调验签
- 微信连续扣费真实签约、查约、解约闭环
- 支付宝周期性扣款执行计划与真实扣款闭环
- 扣款失败补偿、重试和查单补偿
- 更复杂的订阅变更，比如升级、降级、下周期切换计划

这些不影响当前“积分包购买”直接使用，但会影响“自动续费是否可直接上线”。

## 一、`go-pay/gopay` 的核心逻辑

项目地址：

- https://github.com/go-pay/gopay
- 微信 v3 文档：https://github.com/go-pay/gopay/blob/main/doc/wechat_v3.md
- 支付宝 v3 文档：https://github.com/go-pay/gopay/blob/main/doc/alipay_v3.md

### 1. 它本质上是支付协议 SDK，不是订单系统

`gopay` 负责的是：

- 初始化各支付渠道客户端
- 发起下单请求
- 生成支付参数或支付链接
- 解析支付回调
- 验签
- 解密微信回调密文
- 调用查单、退款、关闭订单等支付网关接口

`gopay` 不负责的是：

- 你的业务订单建模
- 用户权益发放
- 幂等落库
- 分销归因
- 积分账本
- 订阅生命周期编排

这点非常重要。你项目当前已经把这些业务层逻辑做出来了，所以接入微信支付宝时，应该把 `gopay` 当成“渠道适配层”，而不是重新设计业务核心。

### 2. `gopay` 的通用支付模式

无论微信还是支付宝，`gopay` 的接入思路都类似：

1. 初始化客户端并注入商户凭证
2. 设置回调地址 `notify_url`
3. 传入业务订单号 `out_trade_no`
4. 传入金额、商品描述、用户标识等
5. 调用渠道下单接口
6. 前端拿到支付链接、二维码链接或调起参数
7. 支付平台异步通知你的服务端
8. 服务端验签
9. 服务端查订单或直接基于通知落业务单
10. 返回平台要求的成功回执，避免重复通知

### 3. 微信支付 v3 在 `gopay` 里的关键点

从 `doc/wechat_v3.md` 可以看到，`gopay` 的微信 v3 能力主要包括：

- `wechat.NewClientV3(...)` 初始化商户客户端
- 可配置自动验签
- 可按不同场景下单
  - `V3TransactionJsapi`
  - `V3TransactionApp`
  - 其他交易场景对应的 v3 接口
- `wechat.V3ParseNotify(req)` 解析回调
- `notifyReq.VerifySignByPKMap(...)` 验签
- `notifyReq.DecryptPayCipherText(apiV3Key)` 解密支付结果

微信侧最关键的特点有两个：

- 回调验签和解密是强制主链路
- 前端支付方式会直接影响下单接口选择

这意味着你在项目里不能只抽象成一个“create url”。微信支付至少要区分：

- PC 扫码：Native
- H5 浏览器：H5
- 公众号或内嵌微信：JSAPI
- App：App

对你当前 Web 项目来说，首批建议只做：

- PC 扫码支付
- 移动端 H5 支付
- 如果后面要做公众号，再补 JSAPI

### 4. 支付宝在 `gopay` 里的关键点

从 `doc/alipay_v3.md` 和示例可以看到，支付宝侧主要能力包括：

- `alipay.NewClientV3(...)` 初始化客户端
- 交易创建
  - `TradePrecreate()` 适合扫码
  - `TradePagePay()` 适合 PC 页面跳转
  - `TradeWapPay()` 适合移动端网页
- 回调参数解析
  - `alipay.ParseNotifyToBodyMap(req)`
- 回调验签
  - `alipay.VerifySignWithCert(...)`
- 查单、退款、关单
  - `TradeQuery()`
  - `TradeRefund()`
  - `TradeClose()`

支付宝的特征是：

- 回调是表单参数，不像微信 v3 那样是加密 JSON
- 验签相对直观
- 页面支付和扫码支付都适合 Web 项目

### 5. 从 `gopay` 可以提炼出的设计原则

对你这个项目最有价值的不是某个具体方法，而是这几个设计点：

- 渠道层只关心支付协议
- 业务层统一使用自己的订单号
- 支付成功判断不能只信前端回跳，必须信异步通知
- 异步通知必须做验签和幂等
- 落业务单后再发权益
- 退款、关单、查单都要保留接口，不然后续运营无法处理异常单

## 二、当前项目的支付逻辑

下面是基于当前仓库代码梳理出来的主链路。

### 1. 当前支付提供商只有 `Creem`

当前支付配置在：

- [src/config/payment.ts](/home/visus/code/tripsass/NextDevTpl/src/config/payment.ts:1)
- [src/features/payment/types.ts](/home/visus/code/tripsass/NextDevTpl/src/features/payment/types.ts:1)

当前 `paymentConfig.provider` 固定是 `creem`，货币固定是 `USD`。计划定价也是围绕 `Creem` 的 `priceId` 配的。

这说明现在的产品定价模型，是“站内套餐”映射“Creem 产品/价格”，而不是通用订单商品模型。

### 2. 前台发起支付的入口

主入口在：

- [src/features/payment/actions.ts](/home/visus/code/tripsass/NextDevTpl/src/features/payment/actions.ts:1)
- [src/features/credits/actions.ts](/home/visus/code/tripsass/NextDevTpl/src/features/credits/actions.ts:1)

这里有两条路：

- 订阅购买：`createCheckoutSession`
- 积分包购买：`createCreditsPurchaseCheckout`

两者本质上都是：

1. 组装 metadata
2. 调 `creem.createCheckout`
3. 把用户重定向到 `checkout_url`

也就是说，当前前台没有自己的订单创建表，没有“待支付本地单”。支付前只有一个 `clientOrderKey` 放在 metadata 里。

### 3. 真正的业务入账发生在 webhook

核心代码在：

- [src/app/api/webhooks/creem/route.ts](/home/visus/code/tripsass/NextDevTpl/src/app/api/webhooks/creem/route.ts:1)
- [src/features/payment/creem.ts](/home/visus/code/tripsass/NextDevTpl/src/features/payment/creem.ts:1)

现在的支付结果认定逻辑非常清晰：

1. `Creem` 调 webhook
2. 服务端用 `creem-signature` 做 HMAC 验签
3. 按事件类型分流
   - `checkout.completed`
   - `subscription.active`
   - `subscription.renewed`
   - `subscription.canceled`
   - `subscription.past_due`
   - `subscription.paused`
4. 落统一订单
5. 发积分或维护订阅
6. 结算分销佣金

这是你项目现有支付链路最稳的一部分，也是未来接微信支付宝时最应该保留的一层。

### 4. 当前项目已经有统一订单中心

Schema 在：

- [src/db/schema.ts](/home/visus/code/tripsass/NextDevTpl/src/db/schema.ts:448)
- [src/db/schema.ts](/home/visus/code/tripsass/NextDevTpl/src/db/schema.ts:577)

这里已经有：

- `sales_order_provider` 枚举：`creem`、`wechat_pay`、`alipay`
- `sales_order`
- `sales_order_item`
- 售后事件表

这说明数据库层其实已经给微信和支付宝预留了口子。你的项目不是从零开始缺支付模型，而是“上层业务模型已具备，渠道实现还没补齐”。

### 5. 当前积分发放逻辑是正确的

积分系统相关代码在：

- [src/features/credits/actions.ts](/home/visus/code/tripsass/NextDevTpl/src/features/credits/actions.ts:1)
- [src/db/schema.ts](/home/visus/code/tripsass/NextDevTpl/src/db/schema.ts:1165)

现有设计的优点：

- 购买积分通过 `creditsBatch.sourceRef` 做幂等
- 订阅积分按周期键做幂等
- 积分和支付解耦，不直接绑在支付表上

这意味着未来微信、支付宝支付成功后，只要最终调用同一套 `grantCredits`，积分系统不需要重写。

### 6. 当前订阅逻辑与 `Creem` 耦合较深

当前订阅表在：

- [src/db/schema.ts](/home/visus/code/tripsass/NextDevTpl/src/db/schema.ts:425)

但字段仍然沿用历史列名：

- `stripe_subscription_id`
- `stripe_price_id`

而订阅生命周期逻辑完全围绕 `Creem` webhook 事件组织。比如：

- 创建订阅
- 续费
- 到期取消
- 暂停

这些都依赖 `Creem` 的订阅事件模型。

所以有一个很关键的现实结论：

**如果你现在要接微信支付宝，最适合先接的是一次性支付，不是自动续费订阅。**

原因不是做不到，而是：

- 微信连续扣费和支付宝代扣都比一次性支付复杂得多
- 你当前前端和后端都没有为“多提供商订阅生命周期”做抽象
- 现在直接把微信、支付宝也拉进订阅模型，会把取消、续费、查约、补单、失败重试全都拉复杂

## 三、当前项目与 `gopay` 的最佳结合方式

### 1. 总体原则

推荐采用“渠道适配层 + 现有业务层不动”的方案。

也就是：

- `gopay` 只负责微信支付宝协议
- 你现有的 `sales_order`、`creditsBatch`、`grantCredits`、`distribution` 继续负责业务结算

不要做成：

- 微信支付宝各自一套独立业务订单
- 各写一套积分发放
- 各写一套路由和回调后的业务落库

那样后面退款、对账、补单会非常乱。

### 2. 推荐的阶段划分

#### 阶段 A：先接一次性支付

优先接这两类商品：

- 积分包购买
- 固定期限会员包

其中“固定期限会员包”建议先按一次性商品做，不做自动续费。

这样做的优点：

- 支付流程最短
- 不需要立即处理复杂代扣协议
- 能最快验证微信、支付宝通道是否稳定
- 能先覆盖国内用户最主要的付款需求

#### 阶段 B：如果业务确认需要，再做订阅代扣

只有在你明确确认下面几点都需要时，再做：

- 微信连续扣费
- 支付宝代扣
- 多渠道订阅管理页
- 多渠道取消订阅
- 多渠道续费失败处理

否则先把一次性支付做好，更符合你当前仓库的成熟度。

## 四、建议的落地架构

### 1. 新增统一支付渠道抽象

建议新增一层统一接口，例如：

- `createPaymentIntent`
- `queryPayment`
- `closePayment`
- `refundPayment`
- `parseNotify`

按 provider 分实现：

- `creem`
- `wechat_pay`
- `alipay`

这里不要把现有 `createCheckoutSession` 直接扩展成一堆 `if provider === ...` 的大函数。更合适的是抽到 `src/features/payment/providers/` 下按渠道拆分。

### 2. 新增“本地待支付订单”层

这是本次接入里最值得补的一层。

当前项目在支付前没有本地订单，只有 webhook 后的 `sales_order`。对于 `Creem` 这类托管 checkout 问题不大，但对微信支付宝不够稳。

建议新增一张“支付意图单”或“待支付订单”表，例如：

- `payment_intent`

建议字段：

- `id`
- `userId`
- `provider`
- `bizType`，如 `credit_purchase`、`membership`
- `bizKey`
- `amount`
- `currency`
- `status`，如 `created`、`paying`、`paid`、`closed`、`refunded`
- `outTradeNo`
- `providerOrderId`
- `providerResponse`
- `metadata`
- `expireAt`
- `paidAt`

它的作用：

- 在发起微信支付宝支付前先落本地单
- 用本地 `outTradeNo` 作为统一商户订单号
- 回调时先查本地单，再做幂等处理
- 主动查单、补单、关单时都有抓手

这是当前架构里缺的关键层。

### 3. 统一商户订单号规则

建议把所有渠道都收口成统一订单号，比如：

`pay_{bizType}_{userId缩写}_{timestamp}_{rand}`

要求：

- 全局唯一
- 可追溯
- 不直接暴露敏感用户信息
- 微信、支付宝都使用同一个 `out_trade_no`

### 4. 统一支付结果处理器

建议新增一层支付结果总线，例如：

- `handlePaymentPaid`
- `handlePaymentRefunded`
- `handlePaymentClosed`

职责：

1. 验证渠道通知
2. 找到本地 `payment_intent`
3. 做幂等判断
4. 更新本地支付状态
5. 落 `sales_order`
6. 发积分或开通权益
7. 分销归因结算

这样微信、支付宝、Creem 都能共用同一套业务入账逻辑。

## 五、微信支付接入方案

### 1. 首批场景建议

建议优先支持：

- PC：Native 扫码支付
- 手机浏览器：H5 支付

暂不建议首批就做：

- JSAPI
- 小程序支付
- 连续扣费

因为你的当前项目主站是标准 Web 站，这两种已经能覆盖大部分用户。

### 2. 所需配置

建议新增环境变量：

- `WECHAT_PAY_MCH_ID`
- `WECHAT_PAY_SERIAL_NO`
- `WECHAT_PAY_API_V3_KEY`
- `WECHAT_PAY_PRIVATE_KEY`
- `WECHAT_PAY_PUBLIC_KEY_ID`
- `WECHAT_PAY_PUBLIC_KEY`
- `WECHAT_PAY_APP_ID`
- `WECHAT_PAY_NOTIFY_URL`

### 3. 服务端流程

#### 创建支付

1. 用户选择微信支付
2. 服务端创建 `payment_intent`
3. 用 `gopay/wechat/v3` 创建订单
4. 把渠道返回结果写回 `payment_intent.providerResponse`
5. 返回前端：
   - 二维码地址
   - H5 跳转地址
   - 订单号
   - 过期时间

#### 回调处理

1. `/api/webhooks/wechat-pay`
2. 用 `wechat.V3ParseNotify(req)` 解析
3. 验签
4. 解密支付通知
5. 以 `out_trade_no` 找本地 `payment_intent`
6. 幂等处理
7. 落 `sales_order`
8. 发积分或开通权益
9. 返回微信要求的成功 JSON

#### 主动查单

在以下场景需要主动查单：

- 用户支付后页面未刷新
- 回调异常
- 支付成功但 webhook 超时
- 运维补单

建议提供内部查单方法，不一定首批开放后台页面。

### 4. 退款

微信退款也建议纳入统一售后链路，不要单独绕开 `sales_after_sales_event`。

流程建议：

1. 发起退款
2. 微信返回受理结果
3. 写售后事件
4. 退款回调或查单确认后
5. 回冲积分或关闭权益

## 六、支付宝接入方案

### 1. 首批场景建议

建议优先支持：

- PC：`TradePagePay`
- 手机浏览器：`TradeWapPay`
- 扫码：`TradePrecreate`

### 2. 所需配置

建议新增环境变量：

- `ALIPAY_APP_ID`
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_APP_PUBLIC_CERT`
- `ALIPAY_ROOT_CERT`
- `ALIPAY_PUBLIC_CERT`
- `ALIPAY_NOTIFY_URL`
- `ALIPAY_RETURN_URL`

### 3. 服务端流程

#### 创建支付

1. 用户选择支付宝
2. 服务端创建 `payment_intent`
3. 根据终端类型选择：
   - PC：`TradePagePay`
   - H5：`TradeWapPay`
   - 扫码：`TradePrecreate`
4. 保存返回结果
5. 前端跳转或展示二维码

#### 回调处理

1. `/api/webhooks/alipay`
2. `alipay.ParseNotifyToBodyMap(req)`
3. `alipay.VerifySignWithCert(...)`
4. 根据 `out_trade_no` 查本地单
5. 幂等更新
6. 落统一订单
7. 发积分或开权益
8. 返回纯文本 `success`

### 4. 退款与查单

支付宝侧建议首批就把下面两个能力一起做掉：

- `TradeQuery`
- `TradeRefund`

原因很现实：

- 国内支付场景里，客服和运营对查单、退款的需求会很快出现
- 如果没有查单能力，回调丢失时会很难排障

## 七、对当前项目最合适的业务方案

### 方案一：保留 `Creem` 订阅，只新增微信支付宝一次性支付

这是我最推荐的方案。

具体做法：

- `Creem` 继续负责国际信用卡订阅
- 微信支付宝先支持：
  - 积分包购买
  - 一次性期限会员

优点：

- 对现有订阅逻辑冲击最小
- 国内用户可以立即付款
- 不需要立刻做多渠道自动续费和取消订阅
- 出问题时定位清晰

这是最符合你当前代码成熟度的路线。

### 方案二：微信支付宝也做自动续费订阅

可以做，但不建议作为第一期。

因为它会新增这些复杂点：

- 签约流程
- 协议状态同步
- 解约
- 续费失败
- 补扣
- 多渠道订阅并存冲突
- 管理台展示与客服处理

如果你现在直接上这套，改动范围会明显超过“接入支付”本身。

## 八、建议的代码改造清单

### 第一批必须做

- 新增 `payment_intent` 表
- 新增微信支付 provider
- 新增支付宝 provider
- 新增统一支付下单入口
- 新增微信 webhook 路由
- 新增支付宝 webhook 路由
- 新增统一支付成功处理器
- 让积分包购买支持选择 provider
- 让定价或购买弹窗支持支付方式选择

### 第二批建议做

- 后台查单
- 后台补单
- 后台退款
- 支付超时关单
- 支付失败原因追踪

### 第三批再考虑

- 微信 JSAPI
- 支付宝当面付更多场景
- 微信连续扣费
- 支付宝代扣订阅

## 九、数据库建议

### 1. 保持 `sales_order` 不动

你现在这层已经够好了，不建议推翻。

### 2. 新增 `payment_intent`

这是本次最关键的新增表。

### 3. 订阅表建议后续去历史命名

现在 `subscription` 表还在用：

- `stripe_subscription_id`
- `stripe_price_id`

虽然目前兼容运行，但如果以后真要支持多支付方订阅，建议再单独做一次字段语义收口，比如：

- `providerSubscriptionId`
- `providerPriceId`
- `provider`

不过这不是微信支付宝一次性支付接入的前置条件，可以放到第二阶段。

## 十、实施顺序建议

### 第 1 步

先把积分包购买改成可选支付方式：

- `creem`
- `wechat_pay`
- `alipay`

### 第 2 步

只完成一次性支付闭环：

- 创建本地单
- 调渠道下单
- 异步通知
- 落统一订单
- 发积分

### 第 3 步

补后台查单和退款。

### 第 4 步

业务确认后，再决定是否把订阅迁到微信支付宝。

## 十一、最终建议

如果以“尽快上线、风险可控、最大复用现有代码”为目标，推荐路线是：

1. 保留现有 `Creem` 订阅逻辑不动
2. 新增 `payment_intent` 作为本地下单层
3. 用 `gopay` 接微信支付和支付宝的一次性支付
4. 支付成功后继续复用现有：
   - `sales_order`
   - `creditsBatch`
   - `grantCredits`
   - `distribution`
5. 等一次性支付跑稳后，再评估自动续费

这个方案的优点是：

- 风险最小
- 复用最多
- 业务闭环最清晰
- 国内支付可以最快落地

## 十二、我建议你下一步直接做的版本

如果要我继续往下做实现，我建议直接按下面这个范围开工：

- 只做“积分包购买”的微信支付和支付宝接入
- 支持 PC 扫码和移动端 H5
- 新增 `payment_intent`
- 新增两个 webhook
- 打通支付成功后发积分
- 暂不做自动续费订阅

这是当前仓库最稳、最值得先落地的一步。

## 十三、后续扩展范围分析

当前“积分包购买”已经完成，但如果后面要继续做：

- 微信连续扣费
- 支付宝代扣订阅
- 后台退款
- 后台查单

就不能继续只靠 `payment_intent` 这一张表。原因很直接：

- `payment_intent` 只适合描述一次性的待支付单
- 自动续费需要单独记录“签约关系”和“扣款周期”
- 后台退款和查单需要单独记录支付网关交互和售后状态

结合当前仓库现状，可以直接复用的基础已经有：

- `subscription`
- `sales_order`
- `sales_order_item`
- `sales_after_sales_event`
- `sales_order_item.refundableAmount / refundedAmount`

真正缺的是：

- 多渠道订阅协议层
- 多渠道订阅任务调度层
- 后台支付运营入口

## 十四、参考 `gopay` 的后续能力拆解

### 1. 微信连续扣费

`gopay` 在 `wechat/papay.go` 里把微信代扣拆成了几类动作：

- 签约：
  - `EntrustPublic`
  - `EntrustAppPre`
  - `EntrustH5`
  - `EntrustPaying`
- 扣款：
  - `EntrustApplyPay`
- 解约：
  - `EntrustDelete`
- 查约：
  - `EntrustQuery`

这个拆法说明微信连续扣费不是“普通支付 + recurring 字段”这么简单，而是两层协议：

1. 先签约，拿到可持续扣费的协议关系
2. 后续每个计费周期再按协议发起扣款

这和当前项目里“一次性支付成功后直接入账”的链路不是同一种模型。

### 2. 支付宝代扣订阅

`gopay` 在 `alipay/member_api.go` 里把代扣协议拆成了：

- 签约页拉起：
  - `UserAgreementPageSign`
  - `UserAgreementPageSignInQRCode`
- 查约：
  - `UserAgreementQuery`
- 解约：
  - `UserAgreementPageUnSign`
- 计划变更：
  - `UserAgreementExecutionplanModify`

这也说明支付宝代扣的核心不是下单，而是“用户授权协议”。

对你当前项目来说，这意味着：

- 订阅购买页不能只返回一个支付链接
- 必须能区分“签约成功”和“本期已扣费成功”
- 协议存在但本期扣费失败，也要落状态

### 3. 查单与退款

`gopay` 对查单和退款也是单独建能力，不和支付创建混在一起：

- 微信：
  - 交易查询
  - 退款申请
  - 退款查询
- 支付宝：
  - `TradeQuery`
  - `TradeRefund`
  - `TradeClose`

这和你项目现在的统一订单设计是匹配的。也就是说：

- “支付创建”负责进入支付流程
- “webhook”负责异步确认
- “查单/退款”负责运营和补偿

这三层应该分开，不要继续堆在一个文件里。

## 十五、对当前项目的承接方案

### 1. 不建议直接复用 `payment_intent` 承接自动续费

原因：

- `payment_intent.bizType` 目前只有 `credit_purchase`
- 自动续费需要长期存在的签约关系，不是一次性待支付单
- 一个订阅会产生多次扣款，不应全部压成同一类 intent

更合适的做法是：

- 保留 `payment_intent` 只处理一次性下单
- 让 `subscription` 继续表示用户订阅主状态
- 新增“订阅协议”和“订阅扣款记录”两层

### 2. 建议新增两张订阅支付表

建议新增：

- `subscription_contract`
- `subscription_billing`

#### `subscription_contract`

职责：记录用户和渠道之间的持续扣费协议。

建议字段：

- `id`
- `userId`
- `subscriptionId`
- `provider`
- `providerContractId`
- `providerPlanId`
- `providerExternalUserId`
- `status`
- `signedAt`
- `terminatedAt`
- `nextBillingAt`
- `metadata`
- `createdAt`
- `updatedAt`

状态建议：

- `pending_sign`
- `active`
- `paused`
- `terminated`
- `failed`

#### `subscription_billing`

职责：记录每一个计费周期的扣款尝试。

建议字段：

- `id`
- `subscriptionId`
- `contractId`
- `provider`
- `billingSequence`
- `periodStart`
- `periodEnd`
- `amount`
- `currency`
- `outTradeNo`
- `providerOrderId`
- `providerPaymentId`
- `status`
- `paidAt`
- `failedAt`
- `failureReason`
- `metadata`
- `createdAt`
- `updatedAt`

状态建议：

- `scheduled`
- `processing`
- `paid`
- `failed`
- `refunded`
- `closed`

### 3. `subscription` 表暂时不需要重做

当前 `subscription` 虽然还沿用历史列名：

- `stripe_subscription_id`
- `stripe_price_id`

但它作为“站内订阅主状态”仍然能继续用。

建议做法：

- 本轮先不改老表列名
- 继续让 `subscription.status/currentPeriodStart/currentPeriodEnd` 作为用户态订阅真值
- 把渠道协议细节放进新表

这样可以避免一次把现有 `Creem` 订阅链路打散。

## 十六、微信连续扣费方案

### 1. 业务目标

微信连续扣费更适合承接：

- 月度订阅
- 年度订阅
- 自动续费会员

不建议拿来做：

- 积分包
- 零散一次性购买

### 2. 推荐落地顺序

#### 阶段 A：只做签约，不做自动扣款切换

范围：

- 新增“微信连续扣费签约”入口
- 签约成功后写入 `subscription_contract`
- 后台能看到协议状态

先不切换生产计费，只验证：

- 用户能签约
- webhook 能回写协议状态
- 后台能查约和解约

#### 阶段 B：做首期扣款与续费扣款

范围：

- 首次签约后发起首期扣款
- 周期到期后由任务触发 `EntrustApplyPay`
- webhook 成功后：
  - 更新 `subscription_billing`
  - 更新 `subscription`
  - 写 `sales_order`
  - 发放订阅积分
  - 结算分销佣金

#### 阶段 C：做失败补偿

范围：

- 扣款失败重试
- 失败后暂停订阅
- 后台手工补扣
- 后台手工查单

### 3. 服务端流程建议

#### 签约

1. 用户在订阅页选择微信连续扣费
2. 服务端创建本地签约申请
3. 调微信签约接口，返回签约 URL 或拉起参数
4. 用户完成签约
5. 微信签约回调到平台
6. 平台写入 `subscription_contract`
7. 平台决定是否立即发起首期扣款

#### 周期扣款

1. 定时任务扫描即将续费的 `subscription_contract`
2. 生成一条 `subscription_billing`
3. 调微信申请扣款
4. 收到异步通知后再确认入账
5. 落 `sales_order`
6. 发订阅积分
7. 更新 `subscription.currentPeriodStart/currentPeriodEnd`

### 4. 风险点

- 微信签约成功不等于当期已收款
- 连续扣费失败后，订阅状态要和权益状态一起收紧
- 要避免同一计费周期重复发积分

当前仓库其实已经有一部分现成经验可复用：

- `src/app/api/webhooks/creem/route.ts` 里已经把
  - `subscription.active`
  - `subscription.renewed`
  - 积分发放
  - 佣金结算
  串起来了

微信连续扣费要做的不是重写这段业务，而是把“事件来源”从 `Creem` 扩成 `wechat_pay`。

## 十七、支付宝代扣订阅方案

### 1. 业务目标

支付宝代扣与微信连续扣费在平台内的职责基本一致：

- 管订阅协议
- 管周期扣款
- 管解约和查约

所以在你项目里，微信和支付宝应共用一套站内抽象：

- 协议层：`subscription_contract`
- 计费层：`subscription_billing`
- 订单层：`sales_order`

不要分别长出两套业务模型。

### 2. 推荐落地顺序

#### 阶段 A：签约闭环

范围：

- 订阅页增加支付宝代扣入口
- 生成签约页 URL 或二维码
- 签约完成后写入 `subscription_contract`
- 提供后台查约和解约

#### 阶段 B：周期扣款闭环

范围：

- 按账期生成 `subscription_billing`
- 调支付宝代扣或周期扣款接口
- 回调成功后更新订阅与权益

#### 阶段 C：变更计划

范围：

- 升级套餐
- 降级套餐
- 下周期生效

这里可以参考 `gopay` 里和协议计划变更有关的接口思想，但项目内部仍然应该先改本地账期，再驱动渠道变更。

### 3. 服务端流程建议

#### 签约

1. 用户选择支付宝代扣订阅
2. 创建本地签约申请
3. 调 `UserAgreementPageSign` 或二维码签约
4. 用户完成协议授权
5. 回调后写 `subscription_contract`
6. 需要首期收款时，再创建 `subscription_billing`

#### 周期扣款

1. 调度器创建本期账单
2. 发起扣款
3. 回调或查单确认后落业务单
4. 发放订阅权益
5. 更新下期扣费时间

### 4. 风险点

- 协议成功但首期扣费失败，要分开处理
- 计划升级和降级要避免穿透到历史账期
- 同一个用户同时保留 `Creem + 微信 + 支付宝` 多条有效订阅时，要加站内互斥规则

建议的站内互斥规则：

- 一个用户同一时刻只允许一条 `active` 自动续费订阅
- 新渠道签约成功前，先检查是否已有活动订阅
- 如需迁移渠道，走“先签新协议，再停旧协议”的后台流程

## 十八、后台退款与查单界面方案

### 1. 当前基础已经够用

你项目里已经有这些基础字段和表：

- `sales_order.providerOrderId`
- `sales_order.providerPaymentId`
- `sales_order.providerSubscriptionId`
- `sales_after_sales_event`
- `sales_order_item.refundableAmount`
- `sales_order_item.refundedAmount`

所以后台不需要先补数据库大改，先做页面和服务就行。

### 2. 后台查单页建议

建议增加 `admin/payments` 或 `admin/orders` 下的支付运营页，支持：

- 按用户邮箱查
- 按站内订单号查
- 按 `outTradeNo` 查
- 按渠道单号查
- 按支付方式查
- 按状态查
- 查看订单项、积分发放、分销归因、售后记录

订单详情页建议展示：

- 基本订单信息
- `payment_intent` 原始下单信息
- 渠道返回原始响应
- 最近一次 webhook 内容
- 售后事件
- 当前可退金额

### 3. 后台退款页建议

退款能力建议只对一次性支付先开放：

- 积分包退款
- 一次性会员退款

订阅退款放后面，原因是它通常还牵涉：

- 已发积分回收
- 已用权益回滚
- 当前周期终止

#### 一次性支付退款流程

1. 管理员在后台选择订单项
2. 输入退款金额和原因
3. 服务端校验 `refundableAmount`
4. 调用渠道退款接口
5. 写一条 `sales_after_sales_event`
6. 更新订单项 `refundedAmount / refundableAmount`
7. 需要时回退积分或释放权益
8. 反向处理分销佣金

### 4. 查单与退款的服务分层

建议新增服务边界：

- `payment-query-service`
- `payment-refund-service`
- `payment-admin-service`

职责建议：

- `payment-query-service`
  - 按 provider 查远端订单
  - 统一返回支付状态
- `payment-refund-service`
  - 按 provider 发起退款
  - 统一写售后事件
- `payment-admin-service`
  - 管理台列表查询
  - 详情拼装
  - 后台操作权限校验

### 5. 退款时的权益处理建议

#### 积分包退款

建议规则：

- 若该批积分还有剩余，可直接扣回
- 若积分已被消费，需要后台阻止退款或走人工处理

这部分可以复用当前积分账本思路，但必须先明确业务规则，再落代码。

#### 订阅退款

建议规则：

- 首期付款后短时间内退款：可撤销订阅并回滚当期积分
- 已进入续费周期后退款：按售后策略决定是否只退现金、不补权益

这类规则不应写死在支付适配层，应放在业务服务里。

## 十九、推荐的实施阶段

### 阶段 4：后台查单

目标：

- 先把后台查单页做出来
- 支持 `payment_intent + sales_order + webhook` 联查

完成标志：

- 管理员能从后台定位一笔微信或支付宝支付
- 能看到当前支付状态与原始响应

### 阶段 5：后台退款

目标：

- 支持一次性支付退款
- 打通售后事件和佣金回退

完成标志：

- 管理员可发起部分退款和全额退款
- `sales_after_sales_event`、订单项退款金额、佣金回退能同步落库

### 阶段 6：微信连续扣费

目标：

- 新增微信签约
- 新增周期扣款
- 打通订阅周期权益发放

完成标志：

- 用户能签约微信自动续费
- 周期任务能发起扣款
- 成功后订阅与积分都能按周期推进

### 阶段 7：支付宝代扣订阅

目标：

- 新增支付宝签约
- 新增周期扣款
- 和微信共用站内协议与账单模型

完成标志：

- 用户能签约支付宝自动续费
- 平台能查约、解约、续费、查单

## 二十、最终建议

如果继续往下做，我建议顺序固定为：

1. 先做后台查单
2. 再做后台退款
3. 然后做微信连续扣费
4. 最后做支付宝代扣订阅

原因：

- 查单和退款能直接复用现有订单中心，收益最快
- 自动续费会引入新数据模型和调度任务，复杂度明显更高
- 微信和支付宝代扣应在同一套站内抽象下推进，不要各做一半

也就是说，后续不是继续在现有一次性支付代码上“打补丁”，而是进入下一层：

- 一次性支付层：`payment_intent`
- 订阅协议层：`subscription_contract`
- 周期账单层：`subscription_billing`
- 统一订单层：`sales_order`
- 售后层：`sales_after_sales_event`

这套分层和 `gopay` 的接口组织方式是一致的，也和你当前仓库已经形成的订单中心方向一致。

## 二十一、阶段 7 之后的开发计划

这一节专门对照当前仓库实现和 `gopay` 已有能力，给出后续应继续开发的逻辑边界。

### 1. 对照 `gopay` 后的结论

从 `gopay` 源码看，微信连续扣费能力至少拆成了：

- 签约：`EntrustPublic`、`EntrustAppPre`、`EntrustH5`、`EntrustPaying`
- 扣款：`EntrustApplyPay`
- 解约：`EntrustDelete`
- 查约：`EntrustQuery`

从 `gopay` 源码看，支付宝个人代扣能力至少拆成了：

- 签约：`UserAgreementPageSign`
- 查约：`UserAgreementQuery`
- 解约：`UserAgreementPageUnSign`
- 周期执行计划调整：`UserAgreementExecutionplanModify`
- 协议转周期扣：`UserAgreementTransfer`

这说明 `gopay` 的思路非常明确：

- 协议管理和扣款执行是两层能力
- 查约、解约、计划调整都不是可有可无的附属功能
- 连续扣费不能只靠“本地写账单 + 等回调”来收尾

对照当前项目，已经具备的是：

- 站内协议模型：`subscription_contract`
- 站内账单模型：`subscription_billing`
- 回调成功后的入账、订单、积分、分销结算
- 支付宝页面签约和解约入口

还缺的是：

- 渠道侧真实周期扣款发起
- 渠道侧查约能力
- 微信真实解约能力
- 连续扣费 webhook 验签
- 定时任务扫描与失败补偿

所以后续开发重点不应继续加页面，而应先补“渠道动作层”。

### 2. 下一阶段建议拆成 4 个小阶段

#### 阶段 8：补连续扣费渠道动作层

目标：

- 把当前 `subscription-recurring.ts` 中“只写本地协议和账单”的逻辑，拆成“本地模型层 + 渠道动作层”
- 统一封装微信和支付宝连续扣费动作，不让路由层直接拼渠道参数

建议补齐的渠道动作：

- 微信：
  - 创建签约参数
  - 发起扣款
  - 查约
  - 解约
- 支付宝：
  - 创建签约参数
  - 查约
  - 解约
  - 修改执行计划

本阶段完成标志：

- 连续扣费相关路由只负责鉴权、参数校验、调用服务
- 渠道参数组装和原始响应落库统一收口到支付服务层

#### 阶段 9：补真实周期扣款与调度

目标：

- 把“生成本地账单”推进到“发起真实扣款”
- 把当前手工 `/bill` 过渡能力升级为“手工触发 + 定时任务共用”

建议流程：

1. 定时任务扫描 `subscription_contract`
2. 判断是否到达 `nextBillingAt`
3. 幂等创建 `subscription_billing`
4. 按渠道发起真实扣款
5. 成功发起后回写 `providerOrderId / providerPaymentId / rawResponse`
6. 等待异步回调确认入账

本阶段完成标志：

- `/bill` 不再只写本地账单
- 定时任务和手工补扣共用同一条发单逻辑
- 同一账期不会重复生成和重复发单

当前进度：

- 已完成
- 剩余未补的是“查单补偿、失败停约、后台排障视图”，放到阶段 10 继续处理

#### 阶段 10：补查约、失败补偿和后台排障

目标：

- 让连续扣费具备线上排障能力

建议补齐：

- 渠道查约
- 渠道查单
- 扣款失败回写 `subscription_billing.status=failed`
- 连续失败后把 `subscription_contract.status` 调整为 `paused`
- 后台手工补扣
- 后台查看协议、账单、渠道原始响应

本阶段完成标志：

- 回调丢失时可主动查单补记账
- 协议异常时可主动查约判断当前状态
- 扣款失败后平台状态不会继续显示正常续费中

当前进度：

- 已完成
- 剩余的是订阅变更、退款策略和最终联调收口，放到阶段 11 继续处理

#### 阶段 11：补订阅变更与售后策略

目标：

- 在生产续费跑稳后，再进入套餐变更和订阅退款

建议范围：

- 升级套餐
- 降级套餐
- 下周期生效
- 首期退款
- 续费退款
- 权益和佣金回退规则

这个阶段不建议提前做，原因是当前最大缺口不是套餐编排，而是渠道动作和生产联调。

### 3. 建议的代码承接方式

为了让后续代码不继续堆在一个文件里，建议按职责拆成下面几层：

- `subscription-recurring.ts`
  - 保留站内业务编排
  - 负责合同状态、账期计算、入账后权益发放
- `recurring-provider-service.ts`
  - 统一封装微信、支付宝连续扣费动作
  - 输出标准化结果
- `recurring-provider-notify.ts`
  - 统一处理连续扣费签约回调和账单回调验签、解析
- `jobs/subscription-recurring`
  - 扫描待续费协议
  - 触发账单与真实扣款

如果不这样拆，后面再补查约、解约、补扣、重试时，`subscription-recurring.ts` 会继续膨胀。

### 4. 当前文档应如何理解“完成”

截至现在，文档里阶段 4 到 7 的“已完成”应理解为：

- 站内模型已搭好
- mock 联调已闭环
- 一次性支付生产链路基本具备
- 自动续费生产链路还没有完全收尾

后续继续开发时，不要再把“签约页能打开”视为自动续费完成。真正的完成标志应是：

- 能真实发起周期扣款
- 能验签处理异步回调
- 能查约、解约、查单
- 能做失败补偿

## 二十二、测试与联调方案

### 1. 本地测试分三层

建议后续测试不要只保留一种方式，而是固定三层：

- 第一层：纯 mock 测试
  - 继续使用 `PAYMENT_MOCK_MODE=true`
  - 验证页面、接口、状态流转、入账、积分、分销
- 第二层：网关半联调
  - 真实生成签约参数或支付参数
  - 回调仍由本地构造请求触发
  - 验证签名、参数、字段映射
- 第三层：真实小额联调
  - 使用真实商户和真实回调
  - 验证完整异步链路

只有第三层通过后，自动续费才能算可上线。

### 2. 支付宝测试建议

从 `gopay` 文档可以确认，支付宝客户端支持沙箱环境，文档里明确写了“新版沙箱文档”，初始化客户端时也支持 `isProd=false`。

因此支付宝建议按下面顺序测：

1. 沙箱测试页面签约
2. 沙箱测试协议查询和解约
3. 沙箱验证异步通知验签
4. 小额真实环境验证首期账单和周期扣款

支付宝这边适合优先把下面能力做真：

- `alipay.user.agreement.page.sign`
- `alipay.user.agreement.query`
- `alipay.user.agreement.unsign`
- `alipay.user.agreement.executionplan.modify`

关于“真实周期扣款接口”本身，建议在正式开发前先按你商户当前已开通的产品能力确认，不要先在代码里写死。原因是 `gopay` 这里更强调协议管理和执行计划调整，具体扣款产品路径要以你实际开通能力为准。

### 3. 微信测试建议

从 `gopay/wechat/papay.go` 当前实现看，连续扣费相关方法都直接走 `doProdPost()` / `doProdGet()`，注释里也全部标了“正式”。基于这一点，可以推断：

- 至少在 `gopay` 这层，没有像支付宝那样单独体现出连续扣费沙箱入口
- 微信连续扣费后续开发不要把“有完整沙箱”作为前置假设

因此微信建议按下面顺序测：

1. 本地 mock 跑通签约、账单、入账、解约状态流转
2. 真实商户小额联调签约
3. 真实商户小额联调首期扣款
4. 真实商户小额联调解约和查约

微信这边后续优先做真的能力应是：

- `EntrustH5` 或你实际要接的签约入口
- `EntrustApplyPay`
- `EntrustDelete`
- `EntrustQuery`

### 4. 回调测试建议

无论微信还是支付宝，连续扣费相关回调都建议补两类测试：

- 单元测试
  - 验签成功
  - 验签失败
  - 重复回调幂等
  - 字段缺失
- 集成测试
  - 签约成功回写协议
  - 扣款成功回写账单和订阅
  - 扣款失败回写失败状态
  - 查单补偿后二次入账不重复发积分

### 5. 推荐的后续验证清单

后续每做完一个阶段，至少跑下面这些验证：

- `pnpm exec tsc --noEmit --pretty false`
- 对应支付阶段测试
- `git diff --check -- docs/payment-wechat-alipay-integration-plan.md`

如果进入真实联调，再补下面这些人工验证：

- 支付宝签约页是否能正常打开
- 微信签约页是否能正常拉起
- 成功回调后 `subscription_contract` 是否进入 `active`
- 成功扣款后 `subscription_billing` 是否变成 `paid`
- `sales_order`、积分、分销是否只落一次
