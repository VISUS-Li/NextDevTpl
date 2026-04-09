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

### 3.5 `model capability`

表示某条模型绑定已经确认支持的能力，例如：

- `text`
- `image_input`
- `image_generation`
- `audio_input`
- `audio_generation`
- `video_input`
- `video_generation`

平台会按请求内容自动推导所需能力，再只从声明了这些能力的模型绑定里选择 provider。

例如：

- 普通文本对话至少需要 `text`
- 带参考图输入的请求需要 `image_input`
- 生成图片的请求需要 `image_generation`
- 音频输入和音频输出会分别要求 `audio_input`、`audio_generation`

如果当前模型虽然在工具白名单里，但模型绑定没有声明所需能力，平台会直接返回 `model_not_allowed`，而不是继续把请求发给上游碰运气。

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
      "content": [
        {
          "type": "text",
          "text": "请结合图片改写这段文案"
        },
        {
          "type": "image_url",
          "imageUrl": "https://example.com/demo.png",
          "detail": "high"
        }
      ]
    }
  ],
  "modalities": ["text"],
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "background": false,
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
| `messages` | `array` | 否 | Chat 消息数组，至少 1 条 |
| `input` | `string \| array` | 否 | `responses` 风格兼容输入，和 `messages` 二选一即可 |
| `messages[].role` | `system \| user \| assistant` | 是 | 消息角色 |
| `messages[].content` | `string \| array` | 是 | 纯文本字符串，或多模态 part 数组 |
| `messages[].content[].type` | `text \| image_url \| image_asset \| audio_url \| audio_asset \| video_url \| video_asset \| file_asset` | 否 | 多模态片段类型 |
| `stream` | `boolean` | 否 | 是否返回 SSE |
| `model` | `string` | 否 | 指定平台模型名 |
| `temperature` | `number` | 否 | 范围 `0-2` |
| `modalities` | `array` | 否 | 希望上游返回的模态，如 `text`、`audio`、`image`、`video` |
| `audio` | `object` | 否 | 音频输出配置，常见字段如 `voice`、`format` |
| `image` | `object` | 否 | 图片输出配置，常见字段如 `aspect_ratio` |
| `background` | `boolean` | 否 | 是否允许任务型挂起返回 |
| `metadata` | `object` | 否 | 业务透传信息，平台仅记录 |

补充说明：

- `image_asset` / `audio_asset` / `video_asset` / `file_asset` 用于引用平台存储中的受控文件
- 平台会在内部把这些资产转换为上游可访问的受控 URL
- 如果 `background=true` 且上游返回任务型结果，接口会先返回 `pending`，再通过轮询接口获取完成态

### 同步成功响应

```json
{
  "success": true,
  "requestId": "air_123456",
  "provider": "geek-default",
  "model": "gpt-4o-mini",
  "content": "这是改写后的内容",
  "status": "completed",
  "output": {
    "text": "这是改写后的内容"
  },
  "task": null,
  "usage": {
    "promptTokens": 120,
    "completionTokens": 80,
    "totalTokens": 200,
    "imageInputTokens": 96
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
| `status` | `string` | 当前请求状态，常见值为 `completed` 或 `pending` |
| `output` | `object` | 平台统一输出结构，可包含 `text`、`audio`、`image`、`video` |
| `task` | `object \| null` | 任务型请求的任务信息，包含 `id` 和 `status` |
| `usage` | `object` | token 使用量 |
| `usage.imageInputTokens` | `number` | 图片输入 token 数量，存在时返回 |
| `usage.audioInputTokens` | `number` | 音频输入 token 数量，存在时返回 |
| `usage.videoInputTokens` | `number` | 视频输入 token 数量，存在时返回 |
| `usage.reasoningTokens` | `number` | 推理 token 数量，存在时返回 |
| `billing.chargedCredits` | `number` | 本次实际扣费积分 |
| `billing.billingMode` | `fixed_credits \| token_based \| cost_plus` | 计费模式 |
| `billing.remainingBalance` | `number` | 用户剩余积分 |

### 任务型挂起响应

当 `background=true` 且上游返回任务型结果时，平台会先返回：

```json
{
  "success": true,
  "requestId": "air_task_123",
  "provider": "geek-default",
  "model": "gpt-4o-mini",
  "content": "",
  "status": "pending",
  "output": {},
  "task": {
    "id": "task_123",
    "status": "pending"
  },
  "usage": {
    "promptTokens": 90,
    "completionTokens": 0,
    "totalTokens": 90
  },
  "billing": {
    "chargedCredits": 0,
    "billingMode": "fixed_credits",
    "remainingBalance": 100
  }
}
```

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
| `request_not_found` | `404` | 请求不存在 |

## 4.2 查询任务结果

`GET /api/platform/ai/chat/result?requestId=<平台请求ID>`

用于查询 `POST /api/platform/ai/chat` 返回 `pending` 的任务型请求结果。

### 成功响应

```json
{
  "success": true,
  "requestId": "air_task_123",
  "provider": "geek-default",
  "model": "gpt-4o-mini",
  "content": "图像已生成",
  "status": "completed",
  "output": {
    "text": "图像已生成",
    "image": "https://example.com/generated-image.png"
  },
  "task": null,
  "usage": {
    "promptTokens": 90,
    "completionTokens": 40,
    "totalTokens": 130
  },
  "billing": {
    "chargedCredits": 3,
    "billingMode": "fixed_credits",
    "remainingBalance": 97
  }
}
```

说明：

- 如果任务仍未完成，`status` 会继续返回 `pending`
- 平台会在轮询到完成态时执行最终结算和积分扣费
- 已完成或失败的请求也可通过这个接口回查当前平台视角结果

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

### 一键写入 Geek 预置配置

`POST /api/platform/ai/admin/presets/geek`

用于快速写入一套可直接开用的 Geek provider、模型绑定和计费规则。

```json
{
  "apiKey": "gk-xxx",
  "providerKey": "geek-default",
  "providerName": "Geek Default",
  "baseUrl": "https://geekai.co/api/v1",
  "models": [
    {
      "modelKey": "gpt-5-mini",
      "modelAlias": "gpt-5-mini",
      "tier": "standard",
      "timeoutMs": 45000
    },
    {
      "modelKey": "gpt-4.1-mini",
      "modelAlias": "gpt-4.1-mini",
      "tier": "cheap"
    }
  ],
  "pricingRules": [
    {
      "toolKey": "redink",
      "featureKey": "rewrite",
      "profile": "text_basic"
    },
    {
      "toolKey": "redink",
      "featureKey": "image-generate",
      "profile": "async_media"
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `apiKey` | Geek 平台 API Key |
| `providerKey` | 平台内部 provider key，默认 `geek-default` |
| `providerName` | 管理后台展示名称 |
| `baseUrl` | Geek OpenAI 兼容入口，默认 `https://geekai.co/api/v1` |
| `models[].tier` | 平台推荐成本档位，可选 `cheap / standard / premium` |
| `pricingRules[].profile` | 平台推荐计费模板，可选 `text_basic / text_long / multimodal_basic / multimodal_heavy / async_media` |

### 默认档位说明

这些值是 `NextDevTpl` 为“先开起来”准备的推荐默认值，不是 Geek 官方报价。
接入后应根据你自己的 Geek 实际账单和业务毛利目标再调整。

#### `models[].tier`

| 档位 | 输入成本 | 输出成本 | 默认超时 |
|------|------|------|------|
| `cheap` | `200` 微美元 / 1k token | `800` 微美元 / 1k token | `30000ms` |
| `standard` | `500` 微美元 / 1k token | `2000` 微美元 / 1k token | `45000ms` |
| `premium` | `1500` 微美元 / 1k token | `6000` 微美元 / 1k token | `60000ms` |

#### `pricingRules[].profile`

| 模板 | 计费模式 | 默认值 |
|------|------|------|
| `text_basic` | `fixed_credits` | 固定扣 `2` 积分，最低 `2` |
| `text_long` | `token_based` | 输入 `600` token / 积分，输出 `300` token / 积分，最低 `2` |
| `multimodal_basic` | `token_based` | 输入 `400` token / 积分，输出 `200` token / 积分，最低 `3` |
| `multimodal_heavy` | `token_based` | 输入 `250` token / 积分，输出 `120` token / 积分，最低 `5` |
| `async_media` | `fixed_credits` | 固定扣 `8` 积分，最低 `8` |

### 成功响应

```json
{
  "success": true,
  "provider": {
    "key": "geek-default"
  },
  "bindings": [
    {
      "modelKey": "gpt-5-mini",
      "inputCostPer1k": 500,
      "outputCostPer1k": 2000
    }
  ],
  "pricingRules": [
    {
      "toolKey": "redink",
      "featureKey": "rewrite",
      "billingMode": "fixed_credits",
      "fixedCredits": 2
    }
  ]
}
```

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
  "capabilities": ["text"],
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
| `providerId` | 这条模型绑定所属的 provider |
| `modelKey` | 平台统一模型名 |
| `modelAlias` | 上游真实模型名 |
| `capabilities` | 模型能力声明，至少要包含 1 项 |
| `costMode` | `manual` 或 `fixed` |
| `inputCostPer1k` | 每 1k 输入 token 的成本，单位为微美元 |
| `outputCostPer1k` | 每 1k 输出 token 的成本，单位为微美元 |
| `fixedCostUsd` | 固定成本，单位为微美元 |

### `capabilities` 可选值

| 值 | 说明 |
|------|------|
| `text` | 支持文本输入与文本输出 |
| `image_input` | 支持图片 URL、图片资产、参考图输入 |
| `image_generation` | 支持直接生成图片结果 |
| `audio_input` | 支持音频 URL、音频资产输入 |
| `audio_generation` | 支持音频或语音结果输出 |
| `video_input` | 支持视频 URL、视频资产输入 |
| `video_generation` | 支持直接生成视频结果 |

### 后台配置说明

管理后台的“模型绑定”页面里，`能力声明` 已改成多选控件。
管理员应只勾选该模型已经在真实上游确认支持的能力，不应把所有能力都默认勾上。

常见建议：

- 普通文本模型通常只勾选 `text`
- 支持看图但不出图的模型勾选 `text + image_input`
- 图片生成模型至少勾选 `image_generation`
- 既支持参考图又支持出图的模型勾选 `text + image_input + image_generation`

### 更新

`PATCH /api/platform/ai/admin/model-bindings/:id`

可更新字段：

- `providerId`
- `modelKey`
- `modelAlias`
- `capabilities`
- `enabled`
- `priority`
- `weight`
- `costMode`
- `inputCostPer1k`
- `outputCostPer1k`
- `fixedCostUsd`
- `maxRetries`
- `timeoutMs`

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

如果是 Geek 接入，也可以直接调用一次：

- `POST /api/platform/ai/admin/presets/geek`

这样可以一次写入 provider、模型绑定和建议计费规则，再按业务需要微调。

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
| `model_not_allowed` | 提示当前模型不支持该能力，提醒管理员检查模型绑定能力声明 |
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
