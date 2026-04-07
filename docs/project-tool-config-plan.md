# 项目工具配置方案

## 背景

当前项目里 AI 配置主要来自环境变量，`src/lib/ai/openai.ts` 会读取
`AI_PROVIDER`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`MIMO_API_KEY` 等配置，
再决定使用哪个 AI 客户端。平台工具接口已经有 `tool` 字段，例如
`src/app/api/platform/results/save/route.ts` 会接收工具标识，但数据库中还没有
项目、工具、字段定义、配置值这几类通用配置表。

本方案的目标是让不同项目、不同工具共用一套配置能力，并支持两类配置：

- 管理员配置：只允许管理员查看和修改，例如平台统一的 AI Key、AI 网关地址、
  第三方服务地址、工具默认提示词。
- 用户配置：允许普通用户按工具设置自己的值，例如自己的 API Key、模型、个人提示词。

## 设计原则

- 一套配置表支撑所有工具，工具差异通过字段定义表达。
- 配置定义只由管理员维护，普通用户只填写允许自己填写的字段。
- 敏感值不返回明文给前端，页面只显示是否已设置和脱敏提示。
- 工具调用只能通过服务端解析配置，客户端不能直接读取管理员密钥。
- 先覆盖 AI 通用配置和工具专属配置，再按实际工具逐步接入。
- 页面操作尽量简单：管理员先选项目，再选工具，再填写分组表单；用户只看到自己可改的字段。
- 工具自己的页面也可以调用 NextDevTpl 后端读取和保存配置，但浏览器接口只返回可展示字段。
- 工具运行时如果需要密钥，必须由服务端调用服务端接口或直接调用配置解析器。

## 推荐数据模型

### 项目表

新增 `project` 表，用于区分不同业务项目。当前模板也可以先写入一个默认项目，
后续再扩展到多项目。

建议字段：

- `id`
- `key`：项目标识，例如 `nextdevtpl`。
- `name`：项目名称。
- `description`
- `enabled`
- `configRevision`：配置版本号，配置写入后递增，供工具判断缓存是否过期。
- `createdAt`
- `updatedAt`

### 工具注册表

新增 `toolRegistry` 表，记录项目可接入的工具。`toolKey` 与平台接口中的
`tool` 字段保持一致，例如 `redink`、`jingfang-ai`。

建议字段：

- `id`
- `projectId`
- `toolKey`
- `name`
- `description`
- `enabled`
- `sortOrder`
- `createdAt`
- `updatedAt`

### 配置字段定义表

新增 `toolConfigField` 表，用字段定义表达每个工具需要哪些配置。管理员可以动态
为工具增加字段，但字段类型、校验规则和可见性必须受控。

建议字段：

- `id`
- `projectId`
- `toolKey`
- `fieldKey`：建议用点分命名，例如 `ai.provider`、`redink.systemPrompt`。
- `label`
- `description`
- `group`：例如 `ai`、`tool`、`advanced`。
- `type`：`string`、`textarea`、`number`、`boolean`、`select`、`json`、`secret`。
- `required`
- `adminOnly`
- `userOverridable`
- `defaultValueJson`
- `optionsJson`
- `validationJson`
- `sortOrder`
- `enabled`
- `createdAt`
- `updatedAt`

字段定义示例：

```json
[
  {
    "toolKey": "redink",
    "fieldKey": "ai.provider",
    "label": "AI 服务商",
    "group": "ai",
    "type": "select",
    "required": true,
    "adminOnly": false,
    "userOverridable": true,
    "optionsJson": ["openai", "deepseek", "mimo"]
  },
  {
    "toolKey": "redink",
    "fieldKey": "ai.apiKey",
    "label": "AI API Key",
    "group": "ai",
    "type": "secret",
    "required": true,
    "adminOnly": false,
    "userOverridable": true
  },
  {
    "toolKey": "redink",
    "fieldKey": "redink.systemPrompt",
    "label": "系统提示词",
    "group": "tool",
    "type": "textarea",
    "required": false,
    "adminOnly": false,
    "userOverridable": true
  },
  {
    "toolKey": "jingfang-ai",
    "fieldKey": "jingfangAi.videoDownloadBaseUrl",
    "label": "第三方视频下载地址",
    "group": "tool",
    "type": "string",
    "required": false,
    "adminOnly": true,
    "userOverridable": false
  }
]
```

### 配置值表

新增 `toolConfigValue` 表，用同一张表保存管理员配置和用户配置。

建议字段：

- `id`
- `projectId`
- `toolKey`
- `fieldKey`
- `scope`：`project_admin` 或 `user`。
- `userId`：用户配置时必填，管理员配置时为空。
- `valueJson`：非敏感值。
- `encryptedValue`：敏感值密文。
- `secretSet`：敏感值是否已设置，用于前端状态展示。
- `revision`：当前配置值版本号。
- `updatedBy`
- `createdAt`
- `updatedAt`

唯一约束建议：

- 管理员配置：`projectId + toolKey + fieldKey + scope`
- 用户配置：`projectId + toolKey + fieldKey + scope + userId`

### 变更记录表

建议新增 `toolConfigAuditLog` 表记录管理员和用户修改动作。敏感字段只记录字段名，
不记录明文或密文。

建议字段：

- `id`
- `projectId`
- `toolKey`
- `fieldKey`
- `scope`
- `userId`
- `actorId`
- `action`
- `createdAt`

## 配置解析顺序

工具运行时只调用一个服务端解析函数：

```ts
getResolvedToolConfig({
  projectKey: "nextdevtpl",
  toolKey: "redink",
  userId,
})
```

解析顺序建议如下：

1. 工具字段定义中的默认值。
2. 项目级管理员配置。
3. 用户配置，仅合并 `userOverridable = true` 的字段。
4. 环境变量兜底，仅用于迁移期，例如当前 `OPENAI_API_KEY`、`AI_PROVIDER`。

最终返回给服务端工具调用的对象示例：

```ts
{
  ai: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "decrypted-secret",
    model: "deepseek-chat",
    temperature: 0.7
  },
  redink: {
    systemPrompt: "..."
  }
}
```

返回给前端编辑页的对象不能包含密钥明文：

```ts
{
  fields: [
    {
      fieldKey: "ai.apiKey",
      label: "AI API Key",
      type: "secret",
      secretSet: true,
      maskedValue: "已设置"
    }
  ]
}
```

## 权限与安全

管理员能力：

- 使用 `adminAction` 保护所有管理员配置读写动作。
- 可以创建项目、启用工具、编辑字段定义、填写管理员配置。
- 可以查看敏感字段是否已设置，但不能从页面读取明文。
- 可以清空或替换密钥。

用户能力：

- 使用 `protectedAction` 保护所有用户配置读写动作。
- 只能查看和修改 `userOverridable = true` 且 `adminOnly = false` 的字段。
- 只能查看自己的配置。
- 提交敏感字段时采用写入式输入，不填表示保留旧值，点击清空才删除旧值。

密钥处理：

- `secret` 类型字段写入 `encryptedValue`，不要写入 `valueJson`。
- 加密密钥优先来自 `CONFIG_SECRET_KEY`，本地开发可复用 `BETTER_AUTH_SECRET`。
- 前端、日志、审计表都不记录明文。
- 工具调用拿到明文后只在当前请求内使用，不写入对象存储或业务结果。

## 前端操作设计

### 管理员页面

建议新增入口：

- `/admin/projects`
- `/admin/projects/[projectId]/tools`
- `/admin/projects/[projectId]/tools/[toolKey]/config`

也可以先做更小版本：在管理后台增加“工具配置”菜单，默认项目固定为
`nextdevtpl`，页面只展示工具列表和配置表单。

管理员页面结构：

- 项目选择：默认项目、启用状态、项目描述。
- 工具列表：`redink`、`jingfang-ai` 等，支持启用和停用。
- 配置表单：按 `AI 配置`、`工具配置`、`高级配置` 分组。
- 字段定义编辑：只给管理员使用，支持新增字段、停用字段、调整排序。
- 预览区：展示当前服务端解析后的配置摘要，不展示密钥明文。

为降低操作成本，第一版建议内置常用字段模板：

- AI 服务商。
- AI 接口地址。
- AI API Key。
- AI 模型。
- AI 温度。
- AI 最大输出长度。
- 工具专属提示词。
- 工具专属第三方服务地址。

### 用户页面

建议把用户配置放在现有设置页，新增一个 `tools` 标签：

- `/dashboard/settings?tab=tools`

页面结构：

- 工具选择器：只展示当前项目已启用、且允许用户配置的工具。
- AI 配置卡片：用户自己的 API Key、模型、接口地址。
- 工具配置卡片：用户自己的提示词、偏好参数。
- 恢复默认按钮：删除该用户在该工具下的某个字段值，回到管理员默认值。
- 保存按钮：只提交当前工具当前分组的配置，避免一次表单过长。

如果后续工具很多，可以再独立成：

- `/dashboard/tools/settings`

## 后端接口与服务

建议按功能新建 `src/features/tool-config` 模块：

- `actions.ts`：管理员和用户配置写入动作。
- `queries.ts`：配置页面读取。
- `resolver.ts`：工具运行时解析配置。
- `schema.ts`：表单和字段定义校验。
- `crypto.ts`：密钥加解密。
- `types.ts`：字段类型和解析结果类型。

核心动作：

- `getAdminToolConfigAction`
- `saveAdminToolConfigAction`
- `saveToolConfigFieldAction`
- `getUserToolConfigAction`
- `saveUserToolConfigAction`
- `resetUserToolConfigFieldAction`

核心查询：

- `getToolRegistry(projectId)`
- `getToolConfigFields(projectId, toolKey)`
- `getToolConfigEditorData(projectId, toolKey, userId?)`

核心解析：

- `getResolvedToolConfig({ projectKey, toolKey, userId })`
- `getResolvedAIConfig({ projectKey, toolKey, userId })`

## 工具侧接口协议

工具有两种接入方式：

- 工具页面接入：例如用户在 redink 自己的页面里修改 redink 配置。
- 工具运行时接入：例如 redink 后端运行任务前需要获取最终 AI 配置，或发现缓存过期后刷新配置。

这两种场景必须使用不同返回值，避免把管理员密钥暴露给浏览器。

### 工具页面读取配置

用于工具自己的前端页面渲染配置表单。接口只返回字段定义、用户可见值、密钥设置状态，
不返回密钥明文。

建议接口：

```http
GET /api/platform/tool-config/editor?projectKey=nextdevtpl&tool=redink
```

返回示例：

```json
{
  "success": true,
  "projectKey": "nextdevtpl",
  "tool": "redink",
  "revision": 12,
  "fields": [
    {
      "fieldKey": "ai.provider",
      "label": "AI 服务商",
      "group": "ai",
      "type": "select",
      "value": "deepseek",
      "source": "user",
      "options": ["openai", "deepseek", "mimo"],
      "editable": true
    },
    {
      "fieldKey": "ai.apiKey",
      "label": "AI API Key",
      "group": "ai",
      "type": "secret",
      "secretSet": true,
      "source": "user",
      "editable": true
    }
  ]
}
```

权限要求：

- 必须登录。
- 只能返回当前用户可见字段。
- `adminOnly = true` 的字段不返回给普通用户。
- `secret` 字段只返回 `secretSet` 和来源，不返回明文。

### 工具页面保存配置

用于工具自己的前端页面保存用户配置。接口只允许写入用户配置，不能写入管理员配置。

建议接口：

```http
POST /api/platform/tool-config/user
```

请求示例：

```json
{
  "projectKey": "nextdevtpl",
  "tool": "redink",
  "values": {
    "ai.provider": "deepseek",
    "ai.apiKey": "sk-user-key",
    "redink.systemPrompt": "..."
  }
}
```

保存规则：

- 只保存 `userOverridable = true` 且 `adminOnly = false` 的字段。
- `secret` 字段为空时保留旧值。
- `secret` 字段需要清空时使用显式字段，例如 `clearSecrets: ["ai.apiKey"]`。
- 保存成功后递增 `configRevision`，并返回新的 `revision`。

返回示例：

```json
{
  "success": true,
  "revision": 13
}
```

### 工具运行时读取配置

用于服务端任务运行前获取最终配置。这个接口可以返回解密后的密钥，但只能给可信服务端使用，
不能给浏览器直接调用。

建议接口：

```http
POST /api/platform/tool-config/runtime
```

请求示例：

```json
{
  "projectKey": "nextdevtpl",
  "tool": "redink",
  "userId": "user_123",
  "knownRevision": 12
}
```

返回示例：

```json
{
  "success": true,
  "revision": 13,
  "changed": true,
  "config": {
    "ai": {
      "provider": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "decrypted-secret",
      "model": "deepseek-chat"
    },
    "redink": {
      "systemPrompt": "..."
    }
  }
}
```

权限要求：

- 同仓库内的 Next.js 服务端代码优先直接调用 `getResolvedToolConfig`，不绕 HTTP。
- 外部工具服务端调用时必须使用服务端凭证，例如工具访问令牌或签名请求。
- 服务端凭证只允许读取指定项目和指定工具，不能读全量配置。
- 响应头使用 `Cache-Control: no-store`，避免密钥被代理缓存。
- 每次调用都写入最小访问日志，只记录项目、工具、用户、调用方和时间，不记录配置值。

如果工具只是要判断缓存是否过期，可以先请求轻量接口：

```http
GET /api/platform/tool-config/revision?projectKey=nextdevtpl&tool=redink
```

返回示例：

```json
{
  "success": true,
  "revision": 13
}
```

工具发现版本号变化后，再调用运行时接口刷新本地缓存。

## 缓存与失效

建议对配置缓存做明确约束：

- 浏览器编辑页不缓存密钥状态，页面打开时读取最新 `editor` 数据。
- 服务端工具运行可以按 `projectKey + toolKey + userId` 缓存短时间配置。
- 管理员配置或用户配置保存后递增 `configRevision`。
- 工具本地缓存必须绑定 `revision`，版本变化后丢弃旧配置。
- 含密钥的运行时响应不能被 HTTP 缓存。
- 如果工具任务排队时间较长，任务真正执行前再检查一次 `revision`。
- 如果解析结果缺少必填字段，返回明确错误，例如“redink 缺少用户 AI API Key”。

## AI 客户端接入方式

当前 `src/lib/ai/openai.ts` 在模块加载时创建多个客户端，这不适合按工具和用户切换
API Key。建议迁移为请求级客户端：

```ts
createAIClient({
  provider,
  apiKey,
  baseUrl,
})
```

工具调用时先解析配置，再创建客户端：

```ts
const config = await getResolvedToolConfig({
  projectKey: "nextdevtpl",
  toolKey: "redink",
  userId,
});

const ai = createAIClient(config.ai);
```

迁移期间保留当前环境变量作为兜底，避免一次性影响已有功能。

## 动态字段校验

字段定义是动态的，但校验规则不能完全放开。建议只允许以下校验项：

- `required`
- `minLength`
- `maxLength`
- `min`
- `max`
- `url`
- `enum`
- `jsonObject`

服务端保存配置时按字段定义生成 Zod 校验。管理员新增字段时也要校验
`fieldKey`，建议只允许小写字母、数字、点号和连字符，避免字段名污染解析对象。

## 示例工具配置

### redink

通用 AI 字段：

- `ai.provider`
- `ai.baseUrl`
- `ai.apiKey`
- `ai.model`
- `ai.temperature`
- `ai.maxTokens`

工具字段：

- `redink.systemPrompt`
- `redink.titlePrompt`
- `redink.copyPrompt`
- `redink.imagePrompt`
- `redink.outputLanguage`

### jingfang-ai

通用 AI 字段：

- `ai.provider`
- `ai.baseUrl`
- `ai.apiKey`
- `ai.model`
- `ai.temperature`
- `ai.maxTokens`

工具字段：

- `jingfangAi.videoDownloadBaseUrl`
- `jingfangAi.videoDownloadApiKey`
- `jingfangAi.analysisPrompt`
- `jingfangAi.summaryPrompt`

## 需要注意的问题

- 配置来源过多会让用户困惑，所以页面必须明确标识“使用管理员默认值”或“使用我的设置”。
- 用户自填 API Key 会带来计费归属问题，需要在说明文案里提示由用户自行承担第三方费用。
- 管理员密钥被用户配置覆盖后，工具运行失败时要能在错误信息中提示当前使用的是用户配置还是管理员默认值。
- 动态字段删除不能直接删历史值，建议先停用字段，确认无工具依赖后再清理数据。
- 密钥轮换需要支持“替换”和“清空”，不能用空字符串意外覆盖旧密钥。
- 配置缓存必须在保存后失效，否则工具调用可能继续使用旧配置。
- `json` 类型字段只建议管理员使用，普通用户优先使用结构化表单字段。
- 工具结果归档不能写入解析后的密钥或完整配置。
- 工具自己的页面保存配置时，也必须走 NextDevTpl 的权限和字段定义校验，不能直接写表。
- 外部工具服务端读取运行时配置时，要限制访问范围，避免一个工具读到另一个工具的密钥。
- 长时间任务不能只依赖启动时缓存，执行前需要检查配置版本。

## 分阶段落地计划

第一阶段：数据层和解析器

- 新增配置相关表和 Drizzle schema。
- 写入默认项目 `nextdevtpl`。
- 写入 `redink` 和 `jingfang-ai` 的工具注册数据。
- 写入 AI 通用字段和工具字段定义。
- 实现配置解析器和密钥加解密。
- 实现 `revision` 递增和运行时缓存判断。
- 增加解析顺序、用户覆盖、密钥脱敏的测试。

第二阶段：管理员配置页面

- 在 `src/config/nav.ts` 的管理端导航增加“工具配置”。
- 新增管理员配置页。
- 支持工具启用、字段定义、管理员配置保存。
- 使用 `adminAction` 做权限保护。
- 保存后刷新 `/admin/tool-config`。

第三阶段：用户配置页面

- 在设置页增加 `tools` 标签。
- 只展示允许用户修改的字段。
- 支持用户保存、清空、恢复默认。
- 使用 `protectedAction` 做权限保护。
- 保存后刷新 `/dashboard/settings?tab=tools`。

第四阶段：工具侧接口

- 增加工具页面读取接口。
- 增加工具页面保存接口。
- 增加工具运行时读取接口。
- 增加配置版本查询接口。
- 补充浏览器不泄漏密钥、服务端可读取最终配置的测试。

第五阶段：AI 调用迁移

- 把 `src/lib/ai/openai.ts` 改为支持传入解析后的 AI 配置。
- 保留环境变量兜底。
- 逐个工具接入 `getResolvedToolConfig`。
- 对 redink 和 jingfang-ai 分别补充最小业务测试。

第六阶段：可观测性和运维

- 增加配置变更审计记录。
- 增加配置缺失和密钥失效的错误提示。
- 增加管理员配置预览，只展示摘要。
- 增加缓存失效测试。

## 推荐第一版范围

第一版不建议做复杂的多项目管理页面。建议先固定默认项目 `nextdevtpl`，
把核心能力做通：

- 管理员可以在 `/admin/tool-config` 配置每个工具。
- 用户可以在 `/dashboard/settings?tab=tools` 配置自己的工具参数。
- redink 等工具自己的页面可以调用工具页面接口读取和保存用户配置。
- 服务端工具调用通过 `getResolvedToolConfig` 读取最终配置。
- 外部工具服务端通过运行时接口读取最终配置，并用 `revision` 刷新缓存。
- 密钥只在服务端解密，前端只显示“已设置”。

这能先满足 redink、jingfang-ai 和后续工具接入，同时控制实现规模。
