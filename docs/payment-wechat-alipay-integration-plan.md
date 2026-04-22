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
