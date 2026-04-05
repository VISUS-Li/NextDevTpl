# tripsass 分销后端 review 与测试记录

日期：2026-04-06
分支：`dist`
参考项目：`~/code/guns-distribution`

## 本轮目标

- 覆盖归因、订单幂等、售后、佣金冻结/解冻/冲正、提现申请/拒绝/打款
- 优先补真实业务链路的 vitest 集成测试
- 优先解决会导致错账或重复落单的问题

## 执行步骤

1. 阅读以下实现与现有测试
   - `src/features/distribution/orders.ts`
   - `src/features/distribution/commission.ts`
   - `src/features/distribution/withdrawal.ts`
   - `src/app/api/webhooks/creem/route.ts`
   - `src/db/schema.ts`
   - `src/test/payment/webhook.test.ts`
   - `src/test/distribution/withdrawal.test.ts`
   - `src/test/distribution/attribution.test.ts`
2. 对照 `guns-distribution` 的提现与账务语义，重点核对冻结金额、拒绝释放、打款扣减
3. 先跑现有分销测试，确认真实阻塞
   - `vitest` 默认只读 `.env.test`
   - 仓库没有 `.env.test`，因此本轮验证使用 `.env.local` 的 `DATABASE_URL`
4. 基于 review 结果补集成测试，先复现高风险问题，再做最小修复
5. 重新跑分销相关测试与 `tsc --noEmit`

## 发现并已修复的问题

### 1. 重复 `checkout.completed` 会改写已落单订单快照

风险：
- 同一事件二次进入时，`sales_order` 会被更新，但 `sales_order_item` 不会同步更新
- 结果是订单金额、订单项金额、积分发放结果可能不一致

修复：
- `src/features/distribution/orders.ts`
- `upsertSalesOrderFromCheckoutCompleted()` 命中幂等键后直接返回，不再改写既有订单

对应测试：
- `src/test/payment/webhook.test.ts`
- `重复的 checkout.completed 不应该改写已落单金额快照`

### 2. 重复 `subscription.active` 会重复创建首购订单

风险：
- 首次 `subscription.active` 会把首购 checkout 单改成 `subscription.active`
- 之后同一事件再次进入时，原查询只查 `checkout.completed`，会漏掉已确认首单
- 结果是重复落单，后续佣金和账务有重复触发风险

修复：
- `src/features/distribution/orders.ts`
- `subscription.active` 复用 `checkout.completed` 或已确认的 `subscription.active` 首单

对应测试：
- `src/test/payment/webhook.test.ts`
- `重复的 subscription.active 不应该重复创建首购订单`

### 3. 订单项 `priceId` 会把空字符串写成 `null`

风险：
- 订单项快照和上游原始载荷不一致
- 订阅商品定位和后续审计会丢值

修复：
- `src/features/distribution/orders.ts`
- 构造订单项时保留原始 `productId`，不再把空字符串强转成 `null`

对应测试：
- 现有订阅落单测试已经覆盖

### 4. 售后允许超额退款

风险：
- `refundedAmount` 可以超过订单项金额
- `refundableAmount` 虽然被压到 0，但历史金额已经失真
- 会造成订单、售后事件、佣金冲正基数不一致

修复：
- `src/features/distribution/orders.ts`
- `applySalesAfterSalesEvent()` 新增校验：
  - 金额必须大于 0
  - 币种必须和订单一致
  - 金额不得超过当前 `refundableAmount`

对应测试：
- `src/test/payment/webhook.test.ts`
- `超出可退金额的售后事件应该拒绝写入`

### 5. 提现手续费未冻结，也未计入已提现金额

风险：
- 申请提现时只冻结提现额，不冻结手续费
- 打款后 `withdrawnAmount` 只累加提现额，手续费从余额体系里消失
- 会造成 `available + frozen + withdrawn + reversed != totalEarned`

修复：
- `src/features/distribution/withdrawal.ts`
- 冻结金额改为 `amount + feeAmount`
- 拒绝释放与打款扣减都使用同一冻结金额
- `withdrawnAmount` 改为累计实际从佣金池扣走的总额

对应测试：
- `src/test/distribution/withdrawal.test.ts`
- `应该创建提现申请并冻结可用余额`
- `提现手续费应该一并冻结并在打款后计入已提现金额`

### 6. 提现缺少非法金额与币种校验

风险：
- `amount <= 0` 时可构造异常提现申请
- `feeAmount > amount` 时净额可能为负
- 账户币种与申请币种不一致时会出现错账

修复：
- `src/features/distribution/withdrawal.ts`
- 新增以下校验：
  - 提现金额必须大于 0
  - 手续费不得小于 0，且不得大于提现额
  - 申请币种必须与佣金余额币种一致

对应测试：
- `src/test/distribution/withdrawal.test.ts`
- `非法提现金额和币种不匹配应该拒绝`

## 新增或加强的测试点

- 归因
  - cookie 编解码
  - 推广码绑定
  - 重复绑定复用已有归因
- 订单幂等
  - 重复 `checkout.completed` 不重复发积分
  - 重复 `checkout.completed` 不改写订单快照
  - 重复 `subscription.renewed` 不重复落单
  - 重复 `subscription.active` 不重复确认首单
- 售后
  - 部分退款
  - 全额退款
  - 重复拒付通知
  - 超额退款拒绝
- 佣金
  - 有归因订单生成冻结佣金
  - 重复 webhook 不重复记佣金
  - 部分退款按比例冲正冻结佣金
  - 全额退款全额冲正
  - 冻结到期转可用
  - 可用佣金退款后扣减可用余额
- 提现
  - 申请冻结
  - 拒绝释放
  - 打款扣减
  - 手续费冻结与打款
  - 非法金额
  - 币种不匹配

## 修改文件

- `src/features/distribution/orders.ts`
- `src/features/distribution/withdrawal.ts`
- `src/test/payment/webhook.test.ts`
- `src/test/distribution/withdrawal.test.ts`

## 验证结果

执行命令：

```bash
DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' .env.local | tail -n 1) pnpm vitest run src/test/distribution/attribution.test.ts src/test/distribution/withdrawal.test.ts src/test/payment/webhook.test.ts
pnpm typecheck
```

结果：

- `src/test/distribution/attribution.test.ts`：6 通过
- `src/test/distribution/withdrawal.test.ts`：5 通过
- `src/test/payment/webhook.test.ts`：37 通过
- 合计：48 个测试全部通过
- `pnpm typecheck` 通过

## 仍需关注的点

- `commission.ts`、`orders.ts`、`withdrawal.ts` 里的多表账务写入目前仍不是整段事务化
- 本轮没有复现实错账，但从静态 review 看，若未来引入数据库异常或并发写失败，仍有留下半成状态的可能
- 这部分建议下一轮以事务边界为主题继续收口
