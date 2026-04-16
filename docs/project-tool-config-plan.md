# 项目工具配置方案

## 当前结论

本文档已按最新决策更新，后续 `NextDevTpl` 的工具配置能力按下面这套简单方案推进：

- `NextDevTpl` 只负责统一存储、统一展示、统一权限、统一运行时读取。
- `NextDevTpl` 不再长期维护每个工具的语义化字段清单。
- 平台侧只提供固定数量的通用槽位字段，例如 `config1`、`secret1`、`json1`、`text1`。
- 每个工具自己在代码里维护“槽位 -> 业务配置”的映射关系。
- 删除配置值时直接删除，不做软删除。
- 工具如果缺少自己需要的配置，运行时直接报错，不在平台层做额外兜底。

这套方案的目标不是做复杂的动态字段平台，而是用最少的实现满足：

- 后续工具增删配置项时，尽量不改 `NextDevTpl` 代码。
- 不同工具之间的配置严格隔离。
- 平台不理解工具业务含义，工具自己负责解释配置。

## 当前实现状态

当前仓库已经有以下基础能力：

- 已有配置表：`project`、`toolRegistry`、`toolConfigField`、`toolConfigValue`、`toolConfigAuditLog`
- 已有默认项目：`nextdevtpl`
- 已有默认工具：`redink`、`jingfang-ai`
- 已有管理员页面：`/[locale]/admin/tool-config`
- 已有用户页面入口：`/[locale]/dashboard/settings?tab=tools`
- 已有接口：
  - `GET /api/platform/tool-config/editor`
  - `POST /api/platform/tool-config/user`
  - `POST /api/platform/tool-config/runtime`
  - `POST /api/platform/tool-config/runtime-save`
  - `GET /api/platform/tool-config/revision`
- 已有运行时解析顺序：字段默认值 -> 管理员配置 -> 用户配置
- 已有密钥加密逻辑：优先使用 `CONFIG_SECRET_KEY`，未设置时退回 `BETTER_AUTH_SECRET`

当前还需要调整的重点：

- 现有默认字段仍偏向工具语义字段，不适合长期沿用
- 现有文档里“动态字段后台”的方向过重，不符合当前要的简单实现
- `NextDevTpl` 需要收敛成固定通用槽位，不再继续为每个工具写专属字段

## 目标

最终平台只做四件事：

1. 管理项目和工具
2. 管理每个工具下的通用槽位值
3. 对外返回当前工具解析后的最终配置对象
4. 保证管理员配置、用户配置、密钥加密和权限控制

平台不做这些事：

- 不负责理解 `jingfang-ai`、`redink` 的业务字段语义
- 不负责维护每个工具各自的字段命名体系
- 不做复杂字段定义后台
- 不做软删除

## 设计原则

- 一套配置表支撑所有工具，工具之间仅通过 `projectKey + toolKey` 隔离。
- 字段集合固定为通用槽位，避免每次接入新工具都改模板代码。
- 平台页面只负责展示槽位，不负责解释业务含义。
- 敏感值不返回前端明文。
- 工具调用只能通过服务端解析配置，客户端不能直接读取管理员密钥。
- 工具自己维护槽位映射；缺值时报错，不在平台做额外兜底。
- 删除值直接删记录，不保留“停用但继续存在”的状态。

## 通用槽位方案

### 槽位分类

推荐固定四类槽位：

- `config1 ~ config20`
  - 普通短文本
  - 适合 URL、provider、model、bucket、region 这类值
- `secret1 ~ secret10`
  - 敏感字符串
  - 适合 API Key、Access Key、Token
- `json1 ~ json10`
  - JSON 对象
  - 适合结构化配置
- `text1 ~ text10`
  - 长文本
  - 适合提示词、命令模板、说明文本

这四类已经足够覆盖大多数工具场景。除非后续确有必要，否则不继续增加 `cmd1`、`param1` 这类新分类。

### 工具映射示例

以 `jingfang-ai` 为例，平台只存：

- `secret1`
- `secret2`
- `config1`
- `config2`

真正业务含义由工具自己解释，例如：

```ts
const JINGFANG_SLOT_MAP = {
  gpt: "secret1",
  yunwu_api_key: "secret2",
  chat_api_platform: "config1",
  space_name: "config2",
  access_key_id: "secret3",
  secret_access_key: "secret4",
  asr_app_id: "config3",
  asr_app_type: "config4",
  asr_access_token: "secret5",
  doubao_vision_endpoint: "config5",
  region: "config6",
} as const;
```

`NextDevTpl` 不需要知道这些业务名，只返回槽位值。`jingfang-ai` 自己把这些槽位拼成自己的运行时结构。

## 推荐数据模型

### 项目表

`project` 表继续保留，职责不变。

建议字段：

- `id`
- `key`
- `name`
- `description`
- `enabled`
- `configRevision`
- `createdAt`
- `updatedAt`

### 工具注册表

`toolRegistry` 表继续保留，职责不变。

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

`toolConfigField` 表继续保留，但用途要收缩为“固定槽位定义”，而不是“工具语义字段定义”。

建议字段：

- `id`
- `projectId`
- `toolKey`
- `fieldKey`
- `label`
- `description`
- `group`
- `type`
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

这里的 `fieldKey` 不再使用 `ai.provider`、`jingfangAi.videoDownloadBaseUrl` 这类语义化名字，而是固定为：

- `config1`
- `config2`
- ...
- `secret1`
- `secret2`
- ...
- `json1`
- ...
- `text1`
- ...

字段定义示例：

```json
[
  {
    "toolKey": "jingfang-ai",
    "fieldKey": "config1",
    "label": "config1",
    "group": "config",
    "type": "string",
    "required": false,
    "adminOnly": false,
    "userOverridable": true
  },
  {
    "toolKey": "jingfang-ai",
    "fieldKey": "secret1",
    "label": "secret1",
    "group": "secret",
    "type": "secret",
    "required": false,
    "adminOnly": false,
    "userOverridable": true
  },
  {
    "toolKey": "jingfang-ai",
    "fieldKey": "json1",
    "label": "json1",
    "group": "json",
    "type": "json",
    "required": false,
    "adminOnly": true,
    "userOverridable": false
  },
  {
    "toolKey": "jingfang-ai",
    "fieldKey": "text1",
    "label": "text1",
    "group": "text",
    "type": "textarea",
    "required": false,
    "adminOnly": false,
    "userOverridable": true
  }
]
```

### 配置值表

`toolConfigValue` 表继续保留，职责不变。

建议字段：

- `id`
- `projectId`
- `toolKey`
- `fieldKey`
- `scope`
- `userId`
- `valueJson`
- `encryptedValue`
- `secretSet`
- `revision`
- `updatedBy`
- `createdAt`
- `updatedAt`

唯一约束建议：

- 管理员配置：`projectId + toolKey + fieldKey + scope`
- 用户配置：`projectId + toolKey + fieldKey + scope + userId`

### 变更记录表

`toolConfigAuditLog` 表继续保留，但只记录最小动作信息，不记录明文。

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
  toolKey: "jingfang-ai",
  userId,
})
```

解析顺序保持简单：

1. 字段默认值
2. 项目管理员配置
3. 用户配置

不在平台层追加额外的业务兜底规则。

最终返回给工具服务端的是“槽位对象”，例如：

```ts
{
  config1: "yunwu",
  config2: "space-demo",
  config3: "123456",
  config4: "volc.bigasr.sauc.duration",
  config5: "tos-cn-beijing.ivolces.com",
  config6: "cn-north-1",
  secret1: "sk-geekai",
  secret2: "sk-yunwu",
  secret3: "ak-demo",
  secret4: "sk-demo",
  secret5: "asr-token",
  json1: {
    enabled: true
  },
  text1: "自定义提示词"
}
```

工具服务端再自己映射成内部配置结构，例如 `setting_json`、`aiConfig` 或其他业务对象。

## 权限与安全

管理员能力：

- 使用 `adminAction` 保护所有管理员配置读写动作
- 可以启用和停用工具
- 可以填写管理员默认槽位值
- 可以查看敏感字段是否已设置
- 可以替换或清空密钥

用户能力：

- 使用 `protectedAction` 保护所有用户配置读写动作
- 只能查看和修改允许用户覆盖的槽位
- 只能查看自己的配置
- 提交敏感字段时，不填表示保留旧值；显式清空时才删除

密钥处理：

- `secret` 类型写入 `encryptedValue`
- 明文不写日志、不写审计表、不返回浏览器
- 工具运行时拿到明文后只在当前请求内使用

## 前端操作设计

### 管理员页面

管理员页面继续保留一个简单入口：

- `/admin/tool-config`

页面结构：

- 工具列表：`redink`、`jingfang-ai` 等
- 配置表单：按 `config`、`secret`、`json`、`text` 分组展示
- 每个工具默认展示同一套固定槽位
- 页面不解释槽位业务含义，只展示槽位名

第一版不做这些能力：

- 不做字段定义 CRUD
- 不做拖拽排序后台
- 不做语义字段后台

### 用户页面

建议继续使用：

- `/dashboard/settings?tab=tools`

页面结构：

- 工具选择器
- 当前工具的用户可编辑槽位表单
- 保存按钮
- 清空按钮

仍然只展示槽位，不展示平台侧业务语义。

## 后端接口与服务

建议继续使用当前 `src/features/tool-config` 模块，职责收敛为：

- `actions.ts`
  - 管理员和用户配置写入
- `service.ts`
  - 页面读取
  - 运行时配置解析
  - 固定槽位种子写入
- `schema.ts`
  - 接口参数校验

核心动作：

- `saveAdminToolConfigAction`
- `saveUserToolConfigAction`

核心查询：

- `getAdminToolConfigPageData(projectKey)`
- `getUserToolConfigPageData({ userId, projectKey })`
- `getToolConfigEditorData({ projectKey, toolKey, userId, mode })`

核心解析：

- `getResolvedToolConfig({ projectKey, toolKey, userId })`
- `getToolConfigRevision(projectKey)`

## 工具侧接口协议

工具有两种接入方式：

- 工具前端读取当前工具的槽位配置
- 工具服务端读取最终槽位配置并做本地映射

### 工具页面读取配置

接口：

```http
GET /api/platform/tool-config/editor?projectKey=nextdevtpl&tool=jingfang-ai
```

返回示例：

```json
{
  "success": true,
  "projectKey": "nextdevtpl",
  "tool": "jingfang-ai",
  "revision": 12,
  "fields": [
    {
      "fieldKey": "config1",
      "label": "config1",
      "group": "config",
      "type": "string",
      "value": "yunwu",
      "source": "user",
      "editable": true
    },
    {
      "fieldKey": "secret1",
      "label": "secret1",
      "group": "secret",
      "type": "secret",
      "secretSet": true,
      "source": "project_admin",
      "editable": true
    }
  ]
}
```

### 工具页面保存配置

接口：

```http
POST /api/platform/tool-config/user
```

请求示例：

```json
{
  "projectKey": "nextdevtpl",
  "tool": "jingfang-ai",
  "values": {
    "config1": "yunwu",
    "config2": "space-demo",
    "secret1": "sk-demo"
  },
  "clearSecrets": ["secret2"]
}
```

规则：

- `secret` 为空字符串时保留旧值
- `clearSecrets` 中的字段直接删除原值
- 保存成功后递增 `configRevision`

### 工具运行时读取配置

接口：

```http
POST /api/platform/tool-config/runtime
```

请求示例：

```json
{
  "projectKey": "nextdevtpl",
  "tool": "jingfang-ai",
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
    "config1": "yunwu",
    "config2": "space-demo",
    "secret1": "sk-demo",
    "secret2": "sk-yunwu"
  }
}
```

工具服务端拿到这份结果后，自己做映射。如果它依赖的槽位缺失，直接抛错。

### 外部工具服务端写入配置

接口：

```http
POST /api/platform/tool-config/runtime-save
```

请求示例：

```json
{
  "projectKey": "nextdevtpl",
  "tool": "jingfang-ai",
  "userId": "user_123",
  "values": {
    "config1": "yunwu",
    "secret1": "sk-demo"
  },
  "clearSecrets": ["secret2"]
}
```

这个接口用于像 `jingfang-ai` 这样的外部工具后端，把自己页面上的系统设置写回 `NextDevTpl`。平台只负责保存槽位值，不负责理解这些槽位的业务含义。

## 删除策略

本方案不做软删除。

### 删除配置值

删除某个槽位值时：

- 直接删除 `toolConfigValue` 对应记录
- 若有默认值，则回退到默认值
- 若没有默认值，则运行时读取不到该值

### 删除字段定义

第一版不建议在页面做“字段定义删除”能力，因为字段集合是固定通用槽位。

如果后续确实要裁掉某个槽位，例如不再需要 `text10`：

- 直接从固定种子里移除
- 同时从数据库删除对应 `toolConfigField`
- 同时删除该槽位下历史 `toolConfigValue`

这属于平台结构变更，不属于日常工具配置操作。

## 缓存与失效

保持简单约束：

- 浏览器编辑页不缓存敏感值状态
- 服务端可以按 `projectKey + toolKey + userId + revision` 做短缓存
- 管理员或用户保存后递增 `configRevision`
- 含密钥的运行时响应不做 HTTP 缓存
- 工具发现 `revision` 变化后刷新本地缓存

## 工具接入方式

工具接入时不再要求 `NextDevTpl` 为它增加语义字段，只需要两步：

1. 在 `toolRegistry` 中注册工具
2. 在工具代码里维护槽位映射

### jingfang-ai 示例

平台返回：

```json
{
  "config1": "yunwu",
  "config2": "space-demo",
  "config3": "123456",
  "config4": "volc.bigasr.sauc.duration",
  "config5": "tos-cn-beijing.ivolces.com",
  "config6": "cn-north-1",
  "secret1": "sk-geekai",
  "secret2": "sk-yunwu",
  "secret3": "ak-demo",
  "secret4": "sk-demo",
  "secret5": "asr-token"
}
```

`jingfang-ai` 本地映射后得到：

```json
{
  "gpt": "sk-geekai",
  "yunwu_api_key": "sk-yunwu",
  "chat_api_platform": "yunwu",
  "access_key_id": "ak-demo",
  "secret_access_key": "sk-demo",
  "space_name": "space-demo",
  "asr": {
    "app_id": "123456",
    "app_type": "volc.bigasr.sauc.duration",
    "access_token": "asr-token"
  },
  "ai": {
    "doubao_vision_endpoint": "tos-cn-beijing.ivolces.com",
    "region": "cn-north-1"
  }
}
```

## 需要注意的问题

- 平台页面里的 `config1`、`secret1` 本身不自解释，维护者必须知道各工具自己的槽位映射。
- 如果一个工具需要的槽位值被删掉，运行时应直接报错，不在平台层补默认业务逻辑。
- 槽位数量要一次性预留够用，避免频繁改平台代码增加 `config21`、`secret11`。
- 工具结果归档不能写入平台返回的密钥明文。
- 外部工具服务端读取配置时，仍要限制只允许读取指定工具。

## 分阶段落地计划

第一阶段：平台收敛到固定槽位

- 把现有工具语义字段种子改为固定槽位种子
- 保留 `project`、`toolRegistry`、`toolConfigField`、`toolConfigValue`、`toolConfigAuditLog`
- 保留现有管理员页、用户页、运行时接口
- 补充固定槽位解析测试

第二阶段：工具侧映射接入

- `redink` 维护自己的槽位映射
- `jingfang-ai` 维护自己的槽位映射
- 平台只返回槽位对象
- 工具侧缺少必要值时直接报错

第三阶段：清理旧文档和旧字段

- 清理文档中的语义字段示例
- 清理旧种子中的 `ai.provider`、`jingfangAi.xxx` 等字段
- 清理已不再使用的旧配置说明

## 推荐第一版范围

第一版就做下面这些，不再往复杂方向扩：

- 默认项目固定为 `nextdevtpl`
- 工具通过 `toolKey` 隔离
- 每个工具有同一套固定槽位字段
- 管理员可以配置默认槽位值
- 用户可以配置自己的槽位值
- 运行时接口返回最终槽位配置
- 工具自己做槽位映射
- 删除值时直接删除
- 缺配置时工具直接报错

这已经足够支持 `redink`、`jingfang-ai` 和后续工具接入，同时保持实现简单。
