# 工具可插拔接入架构分析

## 1. 背景与目标

当前 `NextDevTpl` 已经有用户登录、管理员后台、用户设置、工具配置、积分账户、AI 网关、对象存储和平台 API。`redink`、`jingfang-ai` 这类工具已经能绑定这些平台能力，但接入方式仍有不少代码级绑定。

这份文档分析当前工具接入逻辑，并给出后续改成可插拔体系时应考虑的边界、数据模型、接口协议和落地路径。

目标是：

- 后续新增工具时，尽量通过后台配置、数据库注册和统一协议接入
- 新工具默认复用 `NextDevTpl` 的登录、用户、配置、积分、AI、对象存储和审计能力
- 平台层不理解每个工具的业务细节，只维护通用契约
- 工具可以是站内页面，也可以是外部独立服务
- 需要写代码时，只写工具自己的业务适配，不再改平台核心流程

非目标：

- 不做运行时加载任意第三方代码的插件系统
- 不让外部工具直接访问平台数据库
- 不把工具业务 schema 全部塞进平台核心代码
- 不为每个工具单独写一套登录、积分、配置和 AI 调用逻辑

## 2. 当前实现现状

### 2.1 已有通用能力

当前仓库已经具备一套较完整的平台底座：

- 认证与会话：`Better Auth`，核心表为 `user`、`session`、`account`
- 积分体系：`creditsBalance`、`creditsBatch`、`creditsTransaction`
- 工具配置：`project`、`toolRegistry`、`toolConfigField`、`toolConfigValue`、`toolConfigAuditLog`
- AI 网关：`aiRelayProvider`、`aiRelayModelBinding`、`aiPricingRule`、`aiRequestLog`、`aiRequestAttempt`、`aiBillingRecord`
- 对象存储：`storageObject`
- 用户态平台接口：
  - `GET /api/platform/session`
  - `POST /api/platform/credits/check`
  - `POST /api/platform/credits/consume`
  - `POST /api/platform/ai/chat`
  - `GET /api/platform/ai/chat/result`
- 工具运行时配置接口：
  - `POST /api/platform/tool-config/runtime`
  - `POST /api/platform/tool-config/runtime-save`
  - `GET /api/platform/tool-config/revision`
- 管理后台：
  - `/admin/tool-config`
  - `/admin/ai`
  - `/admin/storage`

这些能力已经能承载“工具接入平台”的大部分公共逻辑。

### 2.2 当前工具配置模型

工具配置层的基础设计是对的：

- `projectKey` 区分项目，例如默认 `nextdevtpl`
- `toolKey` 区分工具，例如 `platform`、`storage`、`redink`、`jingfang-ai`
- 字段通过 `toolConfigField` 定义
- 值通过 `toolConfigValue` 保存
- 解析顺序是字段默认值、管理员配置、用户配置
- 密钥字段会加密，前端只知道是否已设置
- 用户只看到 `adminOnly=false` 且 `userOverridable=true` 的字段

这说明配置层已经接近可插拔。新增工具最理想的路径应该是：

1. 注册工具
2. 注册字段槽位
3. 管理员填默认配置
4. 用户填个人覆盖配置
5. 工具服务端读取最终配置并运行

### 2.3 当前写死点

当前主要写死点集中在以下位置。

#### 工具注册写死

`src/features/tool-config/service.ts` 里有 `defaultTools`：

```ts
const defaultTools = [
  { toolKey: "platform", ... },
  { toolKey: "storage", ... },
  { toolKey: "redink", ... },
  { toolKey: "jingfang-ai", ... },
]
```

这意味着新增默认工具要改代码。`seedDefaultToolConfigProject()` 每次都会按这个数组补齐工具。

#### 字段语义写死

同一个文件里有 `TOOL_SLOT_SETTING_LABELS`、`PLATFORM_DEFAULT_RUNTIME_VALUES`、`STORAGE_DEFAULT_RUNTIME_VALUES`、`REDINK_DEFAULT_RUNTIME_VALUES`，并且有 `buildPlatformFieldDefinition()`、`buildStorageFieldDefinition()`、RedInk 模型目录字段特判。

这些逻辑让平台层理解了部分工具业务含义：

- `platform.config1` 是新用户注册奖励积分
- `storage.config1/config2/config3/json1` 是对象存储生命周期配置
- `redink.json4` 是用户可见模型目录
- `redink.config10` 是 AI 资源访问方式
- `jingfang-ai.secret1` 等槽位的显示名也在平台代码里维护

这会导致新工具越多，`service.ts` 越像配置大杂烩。

#### RedInk 业务逻辑写死

RedInk 有专属模块和专属接口：

- `src/features/redink/service.ts`
- `src/app/api/platform/redink/model-options/route.ts`
- `src/app/api/platform/redink/text/route.ts`
- `src/app/api/platform/redink/image/route.ts`
- `src/app/api/platform/redink/request-result/route.ts`

其中写死了：

- RedInk 场景枚举
- RedInk 场景到 AI `featureKey` 的映射
- RedInk 模型目录结构
- RedInk 模型能力过滤
- RedInk 任务结果只能读取 `toolKey = "redink"` 的请求

这类逻辑属于工具业务，应该保留在工具适配层，但不应影响平台核心。

#### AI 默认计费规则写死

`src/features/ai-gateway/service.ts` 里有 `REDINK_DEFAULT_PRICING_RULES`，`seedDefaultPricingRules(toolKey)` 只为 `redink` 补默认规则。

这意味着新工具要自动具备 AI 扣费规则时，仍需要改 AI 网关代码。

#### 存储策略写死

`STORAGE_DEFAULT_RUNTIME_VALUES.json1` 中包含：

- `platform/ai-assets/request/`
- `platform/ai-assets/task/`
- `redink/product-images-temp/`
- `redink/product-videos-temp/`

对象前缀和工具名绑定在平台默认配置里。后续工具如果有自己的临时资源目录，也会继续追加到平台代码。

#### API 路由写死

当前平台有通用接口，也有工具专属接口。专属接口适合复杂工具，但如果每个工具都要新增：

- `/api/platform/{tool}/model-options`
- `/api/platform/{tool}/text`
- `/api/platform/{tool}/image`
- `/api/platform/{tool}/request-result`

后续工具多了以后，平台 API 目录会继续膨胀。

## 3. 核心判断

当前系统不是“完全写死”，而是“底座通用，工具应用写死”。

更准确地说：

- 配置存储已接近通用
- AI 网关已接近通用
- 积分账户已通用
- 登录会话已通用
- 对象存储记录已通用
- 工具注册、默认字段、默认规则、专属路由、场景映射仍写死

所以后续不需要推倒重来。应该把现有能力整理成两个层次：

1. 平台内核：登录、配置、积分、AI、存储、审计、工具注册
2. 工具适配：页面入口、业务场景、模型目录、提示词、输入输出 schema、工具自己的 API

平台内核保持稳定，工具适配可插拔。

## 4. 推荐的可插拔模型

### 4.1 工具分层

建议把工具分成四类：

| 类型 | 说明 | 是否需要写代码 |
| --- | --- | --- |
| 纯配置工具 | 只需要配置和外部跳转，例如填 API Key 后跳到外部工具 | 否 |
| 通用 AI 工具 | 只需要调用 `POST /api/platform/ai/chat`，场景和计费规则可配置 | 少量或不需要 |
| 外部服务工具 | 工具是独立服务，依赖平台会话、配置、积分和 AI API | 工具服务自己写 |
| 站内复杂工具 | 像 RedInk 这样有专属页面、草稿、场景和多接口 | 只写工具模块，不改平台内核 |

这四类不要混成一种“万能插件”。越复杂的工具，越应把业务逻辑留在工具自己的目录或外部服务里。

### 4.2 工具注册信息

`toolRegistry` 现在只记录展示和启停信息。要支持真正可插拔，建议增加一层工具元数据，可以放在 `toolRegistry.metadata` 或新增 `toolApp` 表。

推荐字段：

```json
{
  "toolKey": "redink",
  "name": "RedInk",
  "description": "小红书内容工具",
  "entryType": "internal_route",
  "entryUrl": "/dashboard/tools/redink",
  "runtimeMode": "platform_ai",
  "authMode": "platform_session",
  "configMode": "slot",
  "billingMode": "platform_credits",
  "storageMode": "platform_storage",
  "icon": "pen",
  "sortOrder": 20,
  "enabled": true
}
```

关键字段含义：

- `entryType`
  - `internal_route`：站内页面
  - `external_url`：外部工具链接
  - `api_only`：只提供 API，不展示入口
- `entryUrl`
  - 站内路由或外部服务地址
- `runtimeMode`
  - `none`：不需要运行时能力
  - `platform_api`：只调用平台通用接口
  - `platform_ai`：走平台 AI 网关
  - `custom_adapter`：有工具自己的适配层
- `authMode`
  - 默认 `platform_session`
  - 外部服务可用短期 token 或 OIDC 风格跳转
- `billingMode`
  - `none`
  - `manual_credits`
  - `ai_gateway`
- `storageMode`
  - `none`
  - `platform_storage`

这样平台可以根据注册信息渲染工具入口、展示配置页、决定可调用能力，而不是靠代码枚举。

### 4.3 工具配置字段

现有通用槽位方向是正确的，但应进一步减少平台对工具语义的理解。

建议保留固定槽位：

- `config1 ~ config20`
- `secret1 ~ secret10`
- `json1 ~ json10`
- `text1 ~ text10`

平台只知道类型、权限、默认值、校验规则、展示名，不知道业务含义。

工具自己的业务含义由工具适配层维护。例如 RedInk 可以维护：

```ts
const REDINK_SLOT_MAP = {
  defaultModel: "config1",
  routeStrategy: "config2",
  preferredProvider: "config3",
  allowedModels: "json1",
  featureRules: "json2",
  allowedProviders: "json3",
  modelCatalog: "json4",
  assetUrlMode: "config10",
} as const;
```

但平台核心不再写 `redink.json4` 的特殊解释。

### 4.4 工具能力清单

工具注册时应声明自己需要的平台能力：

```json
{
  "capabilities": {
    "auth": true,
    "userConfig": true,
    "adminConfig": true,
    "credits": true,
    "ai": true,
    "storage": true,
    "webhook": false
  }
}
```

平台可以据此：

- 判断是否在用户设置里显示该工具配置
- 判断是否允许工具调用 AI 网关
- 判断是否显示积分消费记录里的工具筛选
- 判断是否给工具开放对象存储上传接口
- 判断外部工具跳转时是否生成短期登录票据

### 4.5 功能与计费规则

AI 网关的 `toolKey + featureKey` 设计是正确的。后续应把功能定义从代码移到数据。

建议新增或复用配置：

```json
{
  "features": [
    {
      "featureKey": "outline",
      "name": "标题生成",
      "requestType": "chat",
      "defaultOperation": "text.generate",
      "requiredCapabilities": ["text"],
      "pricing": {
        "billingMode": "token_based",
        "minimumCredits": 2,
        "inputTokensPerCredit": 600,
        "outputTokensPerCredit": 300
      }
    },
    {
      "featureKey": "product-post-image",
      "name": "商品发布图",
      "requestType": "chat",
      "defaultOperation": "image.generate",
      "requiredCapabilities": ["image_generation"],
      "pricing": {
        "billingMode": "fixed_credits",
        "fixedCredits": 8,
        "minimumCredits": 8
      }
    }
  ]
}
```

当前 `aiPricingRule` 已经保存了计费规则，缺的是“工具功能定义”。建议新增 `toolFeature` 表，或者先把功能定义存入 `toolRegistry.metadata.features`。

推荐长期表结构：

- `toolFeature`
  - `id`
  - `projectId`
  - `toolKey`
  - `featureKey`
  - `name`
  - `description`
  - `requestType`
  - `defaultOperation`
  - `requiredCapabilities`
  - `enabled`
  - `sortOrder`

然后 `aiPricingRule` 继续只负责计费。

这样新增工具功能时，不需要在 `ai-gateway/service.ts` 写默认规则。

### 4.6 输入输出协议

通用 AI 工具可以直接调用：

```http
POST /api/platform/ai/chat
```

请求携带：

```json
{
  "tool": "my-tool",
  "feature": "summary",
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "model": "gpt-4o-mini",
  "operation": "text.generate",
  "metadata": {
    "projectKey": "nextdevtpl",
    "scene": "summary"
  }
}
```

复杂工具不建议把所有业务输入都塞进平台 AI 接口。它应该有自己的适配层：

1. 工具接口接收业务输入
2. 工具适配层校验业务 schema
3. 工具适配层把业务输入转成平台 AI `messages`
4. 平台 AI 网关负责路由、扣费、记录和返回

也就是说，平台 AI 接口保持通用，业务接口由工具自己管。

## 5. 登录接入设计

### 5.1 站内工具

站内工具最简单，直接使用平台 session：

- 页面使用 `getServerSession()`
- API 使用 `auth.api.getSession()`
- 未登录返回 401 或跳转登录
- 工具记录使用 `userId`

这类工具不需要额外认证协议。

### 5.2 外部工具

外部工具不能直接读取平台 cookie。建议提供两种方式：

#### 方式 A：平台 API 代理

外部工具前端只跳到自己的域名，但所有需要登录的动作都调用 `NextDevTpl` API，并带上平台 cookie。这要求外部工具和平台同站点或有明确的跨域 cookie 策略。

优点是简单。缺点是跨域和部署限制较多。

#### 方式 B：短期工具票据

平台生成一次性或短期票据：

```http
GET /api/platform/tools/{toolKey}/launch
```

返回或跳转：

```text
https://tool.example.com/launch?ticket=...
```

外部工具服务端再调用平台换取用户身份：

```http
POST /api/platform/tools/session/exchange
Authorization: Bearer <tool_runtime_token>
```

返回：

```json
{
  "success": true,
  "user": {
    "id": "...",
    "email": "...",
    "name": "..."
  },
  "toolKey": "my-tool",
  "expiresAt": "..."
}
```

票据需要：

- 短有效期
- 单次使用
- 绑定 `toolKey`
- 绑定 `userId`
- 可审计

这比共享平台 cookie 更稳。

## 6. 配置接入设计

### 6.1 管理员配置

管理员在 `/admin/tool-config` 配工具默认值。

后续应支持后台新增工具和字段，而不是只靠 `seedDefaultToolConfigProject()` 写死。推荐新增管理员能力：

- 新建工具
- 停用工具
- 编辑工具入口
- 编辑工具槽位字段
- 导入工具定义 JSON
- 导出工具定义 JSON

初期可以只做“导入工具定义 JSON”，避免复杂后台。

### 6.2 用户配置

用户在设置页只看到允许覆盖的字段。这个逻辑可以保留。

外部工具如果要让用户在工具内保存配置，应继续调用：

```http
POST /api/platform/tool-config/runtime-save
```

但要加强权限模型。当前这个接口只靠 `TOOL_CONFIG_RUNTIME_TOKEN`，后续应做到：

- token 绑定工具
- token 不能写其他 `toolKey`
- token 可设置过期和轮换
- 记录调用审计

### 6.3 服务端读取配置

外部工具服务端读取配置继续调用：

```http
POST /api/platform/tool-config/runtime
```

推荐响应仍保持：

```json
{
  "success": true,
  "revision": 12,
  "changed": true,
  "config": {
    "config1": "...",
    "secret1": "..."
  }
}
```

注意：

- 只有服务端可读取密钥明文
- 前端永远不返回密钥明文
- `knownRevision` 可继续用于缓存
- 外部工具应缓存配置，但遇到 401、403、revision 变化时刷新

## 7. 积分接入设计

当前积分层已经通用。工具可以两种方式扣费：

### 7.1 AI 网关自动扣费

适合所有 AI 调用：

```http
POST /api/platform/ai/chat
```

平台会根据：

- `toolKey`
- `featureKey`
- `model`
- `aiPricingRule`
- 实际 usage 或固定规则

自动检查余额、执行调用、结算扣费、写入 AI 账本。

这是推荐路径。

### 7.2 手动积分扣费

适合非 AI 工具，例如导出报告、批量任务、外部 API 成本：

```http
POST /api/platform/credits/consume
```

请求应强制带：

```json
{
  "amount": 10,
  "serviceName": "tool:my-tool:export",
  "description": "my-tool/export 消费",
  "metadata": {
    "toolKey": "my-tool",
    "featureKey": "export",
    "requestId": "..."
  }
}
```

建议后续新增统一的工具扣费接口：

```http
POST /api/platform/tools/{toolKey}/credits/consume
```

这样可以在平台层校验 `toolKey` 是否启用、调用 token 是否属于该工具、`featureKey` 是否允许扣费。

## 8. AI 接入设计

当前 AI 网关已经是平台最适合抽象成可插拔的部分。

建议保持一条原则：

工具只声明“我要什么能力”，平台决定“走哪个 provider、哪个模型别名、怎么计费”。

工具请求侧只关心：

- `tool`
- `feature`
- `messages`
- `operation`
- `model`
- `metadata`

平台侧负责：

- 读取工具配置
- 校验允许模型
- 校验 provider 范围
- 校验模型能力
- 查计费规则
- 检查积分
- 发起上游请求
- 记录尝试和结果
- 扣费

### 8.1 RedInk 的启示

RedInk 当前之所以写了专属接口，是因为它不仅是 AI 调用，还需要：

- 业务场景枚举
- 用户可见模型目录
- 文本和图片分组
- 商品发布图和通用图片的不同 feature
- 异步任务轮询
- 草稿表

这类复杂工具保留专属适配层是合理的。要改的是让专属适配层只依赖平台通用契约，而不是让平台核心知道 RedInk 的细节。

## 9. 对象存储接入设计

对象存储目前已有 `storageObject.toolKey`、`purpose`、`requestId`、`taskId`、`retentionClass`，这适合多工具共用。

需要改进的是生命周期规则注册方式。

当前 `storage.json1` 里写了 RedInk 前缀。后续建议每个工具声明自己的存储用途：

```json
{
  "storage": {
    "prefixRules": [
      {
        "prefix": "my-tool/temp/",
        "purpose": "my_tool_temp",
        "retentionClass": "temporary",
        "ttlHours": 72,
        "enabled": true
      }
    ]
  }
}
```

平台在注册工具时把这些规则写入数据库，而不是改 `STORAGE_DEFAULT_RUNTIME_VALUES`。

上传接口也应支持通用参数：

```json
{
  "toolKey": "my-tool",
  "purpose": "input_image",
  "contentType": "image/png",
  "size": 12345,
  "retentionClass": "temporary"
}
```

平台校验：

- 工具启用
- 当前用户登录
- `purpose` 在工具声明范围内
- 文件类型和大小符合工具声明
- 生命周期按工具规则计算

## 10. 推荐新增的工具定义文件

虽然目标是不每次改平台代码，但工具定义需要一个载体。推荐支持 JSON 定义导入，例如：

```json
{
  "toolKey": "my-tool",
  "name": "My Tool",
  "description": "示例工具",
  "entry": {
    "type": "external_url",
    "url": "https://tool.example.com"
  },
  "capabilities": {
    "auth": true,
    "adminConfig": true,
    "userConfig": true,
    "credits": true,
    "ai": true,
    "storage": false
  },
  "fields": [
    {
      "fieldKey": "config1",
      "label": "默认模型",
      "group": "config",
      "type": "string",
      "adminOnly": false,
      "userOverridable": true,
      "defaultValueJson": "gpt-4o-mini"
    },
    {
      "fieldKey": "secret1",
      "label": "工具 API Key",
      "group": "secret",
      "type": "secret",
      "adminOnly": false,
      "userOverridable": true
    }
  ],
  "features": [
    {
      "featureKey": "summary",
      "name": "摘要生成",
      "requestType": "chat",
      "defaultOperation": "text.generate",
      "requiredCapabilities": ["text"],
      "pricing": {
        "billingMode": "token_based",
        "minimumCredits": 1,
        "inputTokensPerCredit": 800,
        "outputTokensPerCredit": 400
      }
    }
  ],
  "storage": {
    "prefixRules": []
  }
}
```

导入后平台写入：

- `toolRegistry`
- `toolConfigField`
- `toolFeature`
- `aiPricingRule`
- 工具存储规则

这一步完成后，多数工具新增都可以不改平台代码。

## 11. 推荐数据库调整

### 11.1 短期不一定要新增表

短期可以先用现有表加 `metadata` 字段承载：

- 工具入口
- 能力声明
- 功能定义
- 存储用途

优点是迁移少。缺点是查询和后台编辑不方便。

### 11.2 中长期建议新增表

建议新增：

#### `tool_feature`

记录工具功能。

- `id`
- `project_id`
- `tool_key`
- `feature_key`
- `name`
- `description`
- `request_type`
- `default_operation`
- `required_capabilities`
- `enabled`
- `sort_order`
- `created_at`
- `updated_at`

#### `tool_runtime_token`

记录外部工具服务端调用平台的 token。

- `id`
- `project_id`
- `tool_key`
- `name`
- `token_hash`
- `scopes`
- `expires_at`
- `last_used_at`
- `enabled`
- `created_at`
- `updated_at`

#### `tool_launch_ticket`

记录外部工具登录跳转票据。

- `id`
- `project_id`
- `tool_key`
- `user_id`
- `ticket_hash`
- `expires_at`
- `used_at`
- `created_at`

#### `tool_storage_rule`

记录工具自己的对象存储规则。

- `id`
- `project_id`
- `tool_key`
- `purpose`
- `prefix`
- `retention_class`
- `ttl_hours`
- `max_size_bytes`
- `content_types`
- `enabled`

## 12. 推荐接口调整

### 12.1 工具注册管理

新增管理员接口：

```http
GET /api/platform/tools
POST /api/platform/tools
GET /api/platform/tools/{toolKey}
PATCH /api/platform/tools/{toolKey}
POST /api/platform/tools/import
```

`POST /api/platform/tools/import` 接收工具定义 JSON，写入工具、字段、功能和默认计费规则。

### 12.2 工具启动

新增：

```http
GET /api/platform/tools/{toolKey}/launch
POST /api/platform/tools/session/exchange
```

服务外部工具跳转和身份换取。

### 12.3 工具配置

保留现有：

```http
POST /api/platform/tool-config/runtime
POST /api/platform/tool-config/runtime-save
GET /api/platform/tool-config/revision
```

但 runtime token 应从全局 token 升级为工具级 token。

### 12.4 工具扣费

保留现有：

```http
POST /api/platform/credits/check
POST /api/platform/credits/consume
```

新增更严格的工具级入口：

```http
POST /api/platform/tools/{toolKey}/credits/check
POST /api/platform/tools/{toolKey}/credits/consume
```

### 12.5 工具通用 AI

保留：

```http
POST /api/platform/ai/chat
GET /api/platform/ai/chat/result
```

复杂工具可以继续有自己的适配接口，但应位于工具模块边界内。

## 13. 迁移当前代码的落地步骤

### 阶段 1：收口平台内核和工具定义

目标：不改业务行为，先减少写死点。

建议动作：

1. 给 `toolRegistry` 增加 `metadata` 字段，或新增工具定义读取函数
2. 把 `defaultTools` 改成从工具定义数组或数据库读
3. 把工具入口、能力声明、槽位显示名从散落常量改成工具定义
4. 保留现有 `seedDefaultToolConfigProject()`，但让它消费工具定义
5. RedInk 先仍作为内置工具定义存在

### 阶段 2：把默认计费规则数据化

目标：去掉 `REDINK_DEFAULT_PRICING_RULES` 的代码特例。

建议动作：

1. 增加 `toolFeature` 或在工具定义中声明 `features`
2. 工具导入时写入 `aiPricingRule`
3. `seedDefaultPricingRules()` 改成按工具定义补规则
4. 管理后台继续允许管理员覆盖价格

### 阶段 3：把存储规则数据化

目标：不再在 `STORAGE_DEFAULT_RUNTIME_VALUES` 里追加工具前缀。

建议动作：

1. 新增工具存储规则定义
2. 平台初始化时按工具定义补存储规则
3. 上传接口支持 `toolKey + purpose`
4. 清理任务按工具规则计算过期时间

### 阶段 4：外部工具接入协议

目标：让独立服务工具不需要共享数据库。

建议动作：

1. 增加工具级 runtime token
2. 增加 launch ticket
3. 增加 ticket exchange 接口
4. 给外部工具提供最小 SDK 或接口示例

### 阶段 5：后台导入工具定义

目标：新增普通工具不再改代码。

建议动作：

1. 后台支持导入工具定义 JSON
2. 导入时校验字段、功能、计费和存储规则
3. 支持禁用工具和回滚最近一次导入
4. 显示工具接入状态和最近调用记录

## 14. RedInk 的推荐改造方式

RedInk 当前可以作为第一个“内置复杂工具”样板。

推荐拆分：

- 平台通用部分：
  - 工具注册
  - 槽位字段
  - 功能定义
  - 计费规则
  - 存储规则
- RedInk 适配部分：
  - 场景枚举
  - 场景到 `featureKey` 的映射
  - 模型目录解释
  - 业务请求 schema
  - 草稿表
  - 专属 API

这样做之后，RedInk 仍然有自己的代码，但平台核心不再因为 RedInk 增加特殊分支。

## 15. 风险与边界

### 15.1 不建议做运行时代码插件

Node 服务端动态加载第三方工具代码会带来：

- 安全风险
- 部署复杂
- 依赖冲突
- 权限隔离困难
- 故障影响平台主进程

更推荐“配置插件 + API 协议 + 工具适配层”的方式。

### 15.2 不要把所有工具都塞进通用接口

通用接口适合配置、积分、AI、存储这类平台能力。复杂业务输入输出仍应由工具自己处理。

否则平台会变成一个巨大的多工具业务集合，后续维护成本更高。

### 15.3 工具级 token 必须替代全局 token

当前 `TOOL_CONFIG_RUNTIME_TOKEN` 是全局的。后续工具多了以后，一个工具泄露 token 会影响所有工具配置，这是必须尽快处理的风险。

### 15.4 工具定义导入要有审计

工具定义会影响：

- 用户可见入口
- 可读取的密钥
- 计费规则
- 可调用 AI 能力
- 对象存储路径

所以导入、更新、停用都要记录管理员、时间和 diff 摘要。

## 16. 最终推荐架构

推荐架构可以概括为：

```text
工具前端或外部服务
  -> 平台登录或工具启动票据
  -> 工具适配层
  -> 平台通用能力
       -> 工具配置
       -> 积分账本
       -> AI 网关
       -> 对象存储
       -> 审计与统计
```

平台内核只维护稳定能力：

- 用户和会话
- 工具注册和入口
- 工具配置和密钥
- 工具功能定义
- 积分检查和扣费
- AI provider、模型、计费和日志
- 对象存储和生命周期
- 审计和运营统计

工具适配层维护业务变化：

- 输入输出 schema
- 场景枚举
- 模型目录展示方式
- 提示词和业务逻辑
- 草稿、项目、任务等工具私有数据

## 17. 结论

当前代码已经有可插拔工具平台的核心底座，但还没有完成工具应用层的可插拔。最值得优先做的不是重写，而是把现有写死在 `tool-config/service.ts`、`ai-gateway/service.ts`、`storage` 默认规则和 RedInk 专属 API 中的工具定义迁移到“工具定义数据”里。

推荐优先级：

1. 工具定义数据化
2. 默认计费规则数据化
3. 工具级 runtime token
4. 外部工具 launch ticket
5. 存储规则按工具注册
6. 后台导入工具定义 JSON

完成这些后，后续普通工具接入主要是新增一份工具定义和工具自己的业务服务；只有复杂站内工具才需要新增适配模块，但也不再需要修改平台核心流程。
