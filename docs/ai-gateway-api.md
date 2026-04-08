# AI 网关接口文档

## 1. 文档用途

本文档给接入 `NextDevTpl` 的外部工具使用，例如：

- `redink`
- `jingfang-ai`
- 其他需要统一调用 AI 的工具

目标是让外部工具不再直接请求上游模型，而是统一调用 `NextDevTpl` 的 AI 网关接口，由平台负责：

- 用户鉴权
- 中转站路由
- 计费和扣费
- 请求日志
- 成本统计
- 失败回退

## 2. 接入原则

### 2.1 调用入口

工具侧统一调用：

- `POST /api/platform/ai/chat`

当前只开放了 `chat` 类型请求。

### 2.2 鉴权方式

当前接口使用站点登录态鉴权，不是独立 API Key。

也就是说，工具调用这些接口时，需要带上用户当前站点会话对应的 Cookie。

适用场景：

- 工具前端嵌入在同域站点内
- 工具服务端代用户调用，并且能够转发用户 Cookie

当前未开放独立的“工具服务凭证调用”协议。如果以后要给纯后端工具调用，再补服务级签名或 token。

### 2.3 计费原则

平台不会信任调用方自己上报的扣费结果。

每次请求都由平台内部完成：

1. 识别用户
2. 识别 `tool` 和 `feature`
3. 选择可用 provider
4. 调用上游模型
5. 计算成本
6. 扣减积分
7. 写入请求日志和结算记录

## 3. 核心概念

### 3.1 `tool`

表示工具标识，例如：

- `redink`
- `jingfang-ai`

### 3.2 `feature`

表示某个工具内的具体功能，例如：

- `rewrite`
- `summary`
- `case-analysis`

平台按 `tool + feature` 匹配计费规则。

### 3.3 `model`

表示请求希望使用的平台模型名，例如：

- `gpt-4o-mini`
- `gpt-4.1-mini`

这里是平台侧模型名，不一定等于上游中转站真实模型别名。

### 3.4 `provider`

表示平台选中的中转站，例如：

- `geek-default`
- `yunwu-main`

这个值由平台决定，调用方只会在响应里看到最终命中的 provider。

## 4. 工具侧接口

## 4.1 统一 AI Chat

`POST /api/platform/ai/chat`

### 请求头

```http
Content-Type: application/json
Cookie: <当前登录用户会话 Cookie>
```

### 请求体

```json
{
  "tool": "redink",
  "feature": "rewrite",
  "messages": [
    {
      "role": "user",
      "content": "请把这段文案改写得更口语化"
    }
  ],
  "stream": false,
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "metadata": {
    "scene": "editor",
    "taskId": "task_123"
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tool` | `string` | 是 | 工具标识，长度 `1-100` |
| `feature` | `string` | 是 | 功能标识，长度 `1-120` |
| `messages` | `array` | 是 | Chat 消息数组，至少 1 条 |
| `messages[].role` | `system \| user \| assistant` | 是 | 消息角色 |
| `messages[].content` | `string` | 是 | 消息内容 |
| `stream` | `boolean` | 否 | 是否返回 SSE |
| `model` | `string` | 否 | 指定平台模型名 |
| `temperature` | `number` | 否 | 范围 `0-2` |
| `metadata` | `object` | 否 | 业务透传信息，平台仅记录 |

### 同步成功响应

```json
{
  "success": true,
  "requestId": "air_123456",
  "provider": "geek-default",
  "model": "gpt-4o-mini",
  "content": "这是改写后的内容",
  "usage": {
    "promptTokens": 120,
    "completionTokens": 80,
    "totalTokens": 200
  },
  "billing": {
    "chargedCredits": 3,
    "billingMode": "fixed_credits",
    "remainingBalance": 97
  }
}
```

### 同步响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 固定为 `true` |
| `requestId` | `string` | 平台请求 ID，后续查询、调账、核账都用它 |
| `provider` | `string` | 最终命中的 provider key |
| `model` | `string` | 最终命中的模型 |
| `content` | `string` | AI 返回文本 |
| `usage` | `object` | token 使用量 |
| `billing.chargedCredits` | `number` | 本次实际扣费积分 |
| `billing.billingMode` | `fixed_credits \| token_based \| cost_plus` | 计费模式 |
| `billing.remainingBalance` | `number` | 用户剩余积分 |

### SSE 响应

当 `stream=true` 时，返回：

```http
Content-Type: text/event-stream; charset=utf-8
```

当前阶段是平台侧 SSE 输出，不是上游逐 token 透传。事件顺序固定为：

1. `meta`
2. `message`
3. `billing`
4. `done`

### SSE 示例

```text
event: meta
data: {"requestId":"air_123456","provider":"geek-default","model":"gpt-4o-mini"}

event: message
data: {"content":"这是改写后的内容"}

event: billing
data: {"chargedCredits":3,"billingMode":"fixed_credits","remainingBalance":97}

event: done
data: [DONE]
```

### 常见错误响应

#### 401 未登录

```json
{
  "success": false,
  "error": "unauthorized",
  "message": "未登录"
}
```

#### 400 参数错误

```json
{
  "success": false,
  "error": "invalid_request",
  "message": "参数错误",
  "details": {}
}
```

#### 403 功能未启用

```json
{
  "success": false,
  "error": "feature_disabled",
  "message": "当前功能未启用"
}
```

#### 403 模型未开放

```json
{
  "success": false,
  "error": "model_not_allowed",
  "message": "当前模型未开放给该工具"
}
```

#### 409 余额不足

```json
{
  "success": false,
  "error": "insufficient_credits",
  "message": "积分不足",
  "required": 3,
  "available": 1
}
```

#### 409 账户冻结

```json
{
  "success": false,
  "error": "account_frozen",
  "message": "账户已冻结"
}
```

#### 503 没有可用中转站

```json
{
  "success": false,
  "error": "provider_unavailable",
  "message": "没有可用的 AI 中转站"
}
```

#### 502 上游异常

```json
{
  "success": false,
  "error": "upstream_error",
  "message": "上游调用失败"
}
```

### 错误码说明

| 错误码 | HTTP 状态 | 说明 |
|------|------|------|
| `unauthorized` | `401` | 未登录 |
| `invalid_request` | `400` | 参数不合法 |
| `feature_disabled` | `403` | 功能未开放 |
| `model_not_allowed` | `403` | 模型未开放 |
| `insufficient_credits` | `409` | 积分不足 |
| `account_frozen` | `409` | 账户冻结 |
| `provider_unavailable` | `503` | 无可用 provider |
| `upstream_error` | `400/502/503` | 上游调用失败 |
| `billing_failed` | `400/500` | 结算失败 |
| `pricing_rule_missing` | `500` | 缺少计费规则 |

## 5. 管理员接口

以下接口仅管理员可调用。

## 5.1 AI 汇总

`GET /api/platform/ai/summary`

### 成功响应

```json
{
  "success": true,
  "overview": {
    "totalRequests": 12,
    "successRequests": 10,
    "failedRequests": 1,
    "insufficientCredits": 1,
    "totalProviderCostMicros": 123456,
    "totalChargedCredits": 56
  },
  "providers": [
    {
      "providerKey": "geek-default",
      "providerName": "Geek Default",
      "totalAttempts": 10,
      "successAttempts": 9,
      "failedAttempts": 1,
      "averageLatencyMs": 530,
      "totalProviderCostMicros": 12345,
      "lastHealthStatus": "healthy"
    }
  ]
}
```

## 5.2 Provider 管理

### 读取 Provider 列表

`GET /api/platform/ai/admin/providers`

### 新增 Provider

`POST /api/platform/ai/admin/providers`

```json
{
  "key": "geek-default",
  "name": "Geek Default",
  "baseUrl": "https://your-provider.example.com/v1",
  "apiKey": "sk-xxx",
  "enabled": true,
  "priority": 1,
  "weight": 100,
  "requestType": "chat"
}
```

### 更新 Provider

`PATCH /api/platform/ai/admin/providers/:id`

可更新字段：

- `key`
- `name`
- `baseUrl`
- `apiKey`
- `enabled`
- `priority`
- `weight`
- `requestType`

### 删除 Provider

`DELETE /api/platform/ai/admin/providers/:id`

## 5.3 Model Binding 管理

### 读取列表

`GET /api/platform/ai/admin/model-bindings`

### 新增

`POST /api/platform/ai/admin/model-bindings`

```json
{
  "providerId": "provider_xxx",
  "modelKey": "gpt-4o-mini",
  "modelAlias": "gpt-4o-mini",
  "enabled": true,
  "priority": 1,
  "weight": 100,
  "costMode": "manual",
  "inputCostPer1k": 150,
  "outputCostPer1k": 600,
  "fixedCostUsd": 0,
  "maxRetries": 0,
  "timeoutMs": 30000
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `modelKey` | 平台统一模型名 |
| `modelAlias` | 上游真实模型名 |
| `costMode` | `manual` 或 `fixed` |
| `inputCostPer1k` | 每 1k 输入 token 的成本，单位为微美元 |
| `outputCostPer1k` | 每 1k 输出 token 的成本，单位为微美元 |
| `fixedCostUsd` | 固定成本，单位为微美元 |

### 更新

`PATCH /api/platform/ai/admin/model-bindings/:id`

### 删除

`DELETE /api/platform/ai/admin/model-bindings/:id`

## 5.4 Pricing Rule 管理

### 读取列表

`GET /api/platform/ai/admin/pricing-rules`

### 新增

`POST /api/platform/ai/admin/pricing-rules`

```json
{
  "toolKey": "redink",
  "featureKey": "rewrite",
  "requestType": "chat",
  "billingMode": "fixed_credits",
  "modelScope": "any",
  "fixedCredits": 3,
  "inputTokensPerCredit": null,
  "outputTokensPerCredit": null,
  "costUsdPerCredit": null,
  "minimumCredits": 3,
  "enabled": true
}
```

### 计费模式说明

| 模式 | 说明 |
|------|------|
| `fixed_credits` | 固定积分扣费 |
| `token_based` | 按输入输出 token 换算积分 |
| `cost_plus` | 按平台成本换算积分 |

### 更新

`PATCH /api/platform/ai/admin/pricing-rules/:id`

### 删除

`DELETE /api/platform/ai/admin/pricing-rules/:id`

## 5.5 请求明细

`GET /api/platform/ai/admin/requests`

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `limit` | `number` | 否 | 默认 `50`，最大 `200` |
| `status` | `string` | 否 | `pending/success/failed/insufficient_credits/billing_failed` |
| `toolKey` | `string` | 否 | 按工具筛选 |

### 示例

```http
GET /api/platform/ai/admin/requests?limit=20&toolKey=redink&status=success
```

## 5.6 Provider 健康检查

`POST /api/platform/ai/admin/providers/health-check`

```json
{
  "providerIds": ["provider_xxx"],
  "disableOnFailure": true
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `providerIds` | 可选，指定检查哪些 provider；不传则检查所有启用中的 provider |
| `disableOnFailure` | 为 `true` 时，检查失败自动下线 |

## 5.7 手工调账

`POST /api/platform/ai/admin/billing-adjustments`

```json
{
  "requestId": "air_123456",
  "direction": "refund",
  "credits": 2,
  "reason": "人工核账退款"
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `requestId` | 平台请求 ID |
| `direction` | `refund` 或 `charge` |
| `credits` | 本次调账积分数，必须大于 0 |
| `reason` | 调账原因 |

## 5.8 运维告警

`GET /api/platform/ai/admin/alerts`

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `costAlertMicros` | `number` | 否 | 高成本告警阈值，单位微美元 |
| `failureRateThreshold` | `number` | 否 | 失败率阈值，范围 `0-1` |

### 示例

```http
GET /api/platform/ai/admin/alerts?costAlertMicros=50000&failureRateThreshold=0.5
```

## 6. 推荐接入流程

## 6.1 工具接入前准备

管理员先完成：

1. 创建 provider
2. 创建 model binding
3. 创建 pricing rule
4. 给目标工具配置允许使用的模型和 provider

## 6.2 工具运行时调用

外部工具运行时只需要做：

1. 带用户登录态调用 `POST /api/platform/ai/chat`
2. 传入正确的 `tool` 和 `feature`
3. 处理成功响应或错误码

工具不需要自己：

- 扣费
- 记账
- 统计
- 选择中转站

## 6.3 推荐错误处理

工具侧建议至少按以下方式处理：

| 错误码 | 建议处理 |
|------|------|
| `unauthorized` | 引导用户重新登录 |
| `insufficient_credits` | 提示积分不足并跳转充值 |
| `feature_disabled` | 提示当前功能未开放 |
| `provider_unavailable` | 提示服务繁忙，稍后重试 |
| `upstream_error` | 可重试 1 次，仍失败则提示稍后再试 |

## 7. 最小接入示例

## 7.1 JavaScript 示例

```ts
async function callPlatformAI() {
  const response = await fetch("/api/platform/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      tool: "redink",
      feature: "rewrite",
      messages: [
        {
          role: "user",
          content: "请把这段内容改写得更自然",
        },
      ],
      stream: false,
      model: "gpt-4o-mini",
      metadata: {
        scene: "editor",
      },
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "AI 请求失败");
  }

  return data;
}
```

## 7.2 SSE 示例

```ts
async function callPlatformAIStream() {
  const response = await fetch("/api/platform/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      tool: "redink",
      feature: "rewrite",
      stream: true,
      messages: [
        {
          role: "user",
          content: "请生成一段更吸引人的版本",
        },
      ],
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    console.log(buffer);
  }
}
```

## 8. 当前限制

1. 当前只支持 `chat`
2. 当前 SSE 是平台侧输出，不是上游逐 token 透传
3. 当前外部工具调用依赖用户登录态，不是独立 API Key
4. 当前管理员录入配置主要通过管理 API，不是完整可视化表单

## 9. 版本说明

本文档基于当前仓库已实现接口编写，适用于当前 `NextDevTpl` 项目内的 AI 网关实现。
