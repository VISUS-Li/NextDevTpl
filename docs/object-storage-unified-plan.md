# 对象存储统一接入设计

## 1. 文档目的

本文档用于给 `NextDevTpl` 规划一套统一的对象存储接入方式，使项目后续可以在以下厂商之间切换，而不需要在业务代码里反复处理差异：

- 火山引擎 TOS
- 腾讯云 COS
- 阿里云 OSS

本文档的目标不是做一个过度抽象的存储平台，而是：

1. 保持现有上传和读取链路尽量少改
2. 让图片、视频、结果归档等文件统一进入对象存储
3. 让 AI 多模态场景拿到公网可访问的文件地址
4. 把厂商差异收敛在存储层，不泄漏到业务层

## 当前进度

### 已完成

- Phase 1 已完成：
  - 已为存储 provider 增加 `getPublicUrl`
  - 已将通用上传接口切回统一存储 provider，不再旁路直连单独 S3 客户端
  - 已支持通过环境变量切换 `local / s3_compatible / oss` 的公共 URL 策略
  - 已支持 `STORAGE_VENDOR / STORAGE_FORCE_PATH_STYLE / STORAGE_PUBLIC_BASE_URL / STORAGE_AI_URL_MODE`
  - AI 多模态资产 URL 已支持优先使用公网地址
  - 已新增独立测试文件 `src/test/platform/storage-phase1-provider.test.ts`
  - 已通过接口级测试，覆盖上传接口返回公网 URL、AI 资产转公网 URL 两条链路
- Phase 2 已完成：
  - 已新增 `storage_object` 表，用于记录对象资源元数据
  - 已支持 `purpose / retentionClass / expiresAt / status` 落库
  - `presigned-image`、`upload/presigned`、`results/save` 已接入资源记录写入
  - 已新增独立测试文件 `src/test/platform/storage-phase2-lifecycle.test.ts`
  - 已通过接口级测试，覆盖临时上传、超短期上传、长期归档三条链路
- Phase 3 已完成：
  - 已新增过期资源清理服务
  - 已新增管理员接口 `POST /api/platform/storage/admin/cleanup-expired`
  - 已支持按 `expiresAt` 清理过期资源并标记删除状态
  - 已新增独立测试文件 `src/test/platform/storage-phase3-cleanup.test.ts`
  - 已通过接口级测试，覆盖管理员清理过期资源链路
- Phase 4 已完成：
  - 已补 `oss` profile 的 virtual-hosted style 约束
  - 已补 OSS 公网 URL 优先使用 bucket 域名的测试
  - 已确认当前中国内地自定义 CNAME 若证书不匹配，不能直接用于 SDK 和签名 URL
  - 已新增管理员对象存储页面 `/admin/storage`
- Phase 5 已完成：
  - 已将短期、临时、长期保留策略收口到后台配置
  - 已支持按前缀配置生命周期规则，并在对象写入时自动匹配默认过期时间
  - 已新增按 `requestId / taskId` 主动整组清理
  - 已新增定时清理接口 `POST /api/jobs/storage/cleanup`
  - 已新增独立测试文件 `src/test/platform/storage-phase45-policy.test.ts`
  - 已通过接口级测试，覆盖后台策略和按范围清理链路

### 当前状态

- 对象存储统一接入、生命周期元数据、过期清理闭环已经完成
- 当前已支持 `local / s3_compatible / oss` 配置收口
- 当前已支持图片和文件上传时同步写入生命周期元数据
- 当前已支持 AI 多模态优先使用公网 URL 访问对象资源
- 当前已支持手动触发过期资源清理
- 当前已支持后台查看对象资源明细、生命周期策略和按范围清理
- 当前已支持按工具切换 `public / proxy` AI 资源访问方式
- 2026-04-09 已完成三家厂商的真实桶连通性验证，当前推荐默认启用火山 TOS
- 2026-04-09 已新增 AI 资产平台代理回源方案，用于规避上游模型直连对象存储域名不稳定的问题
- 2026-04-09 已完成 `redink` 真实链路验收：上传商品图 -> AI 请求 -> 结果归档 -> 后台查看 -> 按 `requestId` 清理

### 真实业务验收补充

- 2026-04-09 本地真实验收结果：
  - `/admin/storage` 页面可正常打开，并能读取后台当前配置和对象明细
  - `redink` 商品图预签名上传已实际写入火山 TOS，公网 URL 实测可读
  - `redink` 结果归档已实际写入对象存储，并可在后台明细中看到 `requestId / taskId`
  - 按 `requestId` 的整组清理已实际删除上传图和结果归档，数据库状态与对象存储状态一致
- 当前遗留问题：
  - `redink` 项目级默认模型现为 `gemini-2.5-flash`
  - 该默认模型在 `geek-default` 上游配置下会出现长时间 `pending`
  - 同一链路改用 `gpt-4o-mini` 后可成功完成真实请求
  - 因此对象存储主链路已可用，但 `redink` 默认 AI 模型配置仍需单独调整

### 真实连通性验证结果

- 火山 TOS
  - 已用真实密钥和桶 `tripai` 完成 `PutObject / GetObject / DeleteObject` 验证
  - `endpoint` 使用 `https://tos-s3-cn-guangzhou.volces.com`
  - 必须使用 `virtual-hosted style`
  - `path-style` 实测会返回 `403 InvalidPathAccess`
  - 推荐配置：
    - `STORAGE_VENDOR=tos`
    - `STORAGE_REGION=cn-guangzhou`
    - `STORAGE_ENDPOINT=https://tos-s3-cn-guangzhou.volces.com`
    - `STORAGE_FORCE_PATH_STYLE=false`
    - `STORAGE_PUBLIC_BASE_URL=https://tripai.tos-cn-guangzhou.volces.com`
- 腾讯 COS
  - 已用真实密钥和桶 `tripai-1315158932` 完成 `PutObject / GetObject / DeleteObject` 验证
  - `endpoint` 使用 `https://cos.ap-guangzhou.myqcloud.com`
  - 当前实现可直接复用通用 `s3Provider`
  - 推荐配置：
    - `STORAGE_VENDOR=cos`
    - `STORAGE_REGION=ap-guangzhou`
    - `STORAGE_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com`
    - `STORAGE_FORCE_PATH_STYLE=false`
    - `STORAGE_PUBLIC_BASE_URL=https://tripai-1315158932.cos.ap-guangzhou.myqcloud.com`
- 阿里 OSS
  - 已用真实密钥和桶 `tripai` 完成 `PutObject / GetObject / DeleteObject` 验证
  - `endpoint` 使用 `https://oss-cn-chengdu.aliyuncs.com`
  - 必须使用 `virtual-hosted style`
  - 你提供的 CNAME 在当前 HTTPS 证书状态下不可直接用于 SDK 访问，实测会出现证书域名不匹配
  - 在 CNAME 证书修好前，SDK 和签名 URL 应继续使用官方 bucket 域名
  - 推荐配置：
    - `STORAGE_VENDOR=oss`
    - `STORAGE_REGION=cn-chengdu`
    - `STORAGE_ENDPOINT=https://oss-cn-chengdu.aliyuncs.com`
    - `STORAGE_FORCE_PATH_STYLE=false`
    - `STORAGE_PUBLIC_BASE_URL=https://tripai.oss-cn-chengdu.aliyuncs.com`

### AI 多模态取图补充结论

- 2026-04-09 实测发现：
  - Geek 文本请求正常
  - Geek 使用官方示例图片的多模态请求正常
  - Geek 直接读取火山 TOS 公网图片地址时会出现长时间等待后失败
- 当前判断：
  - 问题不在平台消息格式
  - 问题集中在上游模型直接抓取对象存储域名时的兼容性
- 当前处理方式：
  - 平台新增 `/api/platform/storage/object` 公开代理路由
  - AI 资产可改为 `STORAGE_AI_URL_MODE=proxy`
  - 上游模型统一访问平台域名，由平台回源对象存储并返回 `inline` 内容

## 2. 当前代码现状

当前项目已经有一套最小存储抽象，核心位置如下：

- 存储接口：[`src/features/storage/types.ts`](/home/visus/code/tripsass/NextDevTpl/src/features/storage/types.ts)
- 存储提供者选择：[`src/features/storage/providers/index.ts`](/home/visus/code/tripsass/NextDevTpl/src/features/storage/providers/index.ts)
- 本地存储：[`src/features/storage/providers/local.ts`](/home/visus/code/tripsass/NextDevTpl/src/features/storage/providers/local.ts)
- S3 兼容存储：[`src/features/storage/providers/s3.ts`](/home/visus/code/tripsass/NextDevTpl/src/features/storage/providers/s3.ts)

当前已经接到存储层的业务包括：

- 头像上传
- 通用文件预签名上传
- `redink` 商品图预签名上传
- 平台结果归档
- AI 多模态资产读取

相关入口：

- [`src/app/api/platform/storage/presigned-image/route.ts`](/home/visus/code/tripsass/NextDevTpl/src/app/api/platform/storage/presigned-image/route.ts)
- [`src/app/api/upload/presigned/route.ts`](/home/visus/code/tripsass/NextDevTpl/src/app/api/upload/presigned/route.ts)
- [`src/app/api/platform/results/save/route.ts`](/home/visus/code/tripsass/NextDevTpl/src/app/api/platform/results/save/route.ts)
- [`src/features/ai-gateway/service.ts`](/home/visus/code/tripsass/NextDevTpl/src/features/ai-gateway/service.ts)

当前实现的优点：

- 业务层已经通过 `StorageProvider` 解耦
- 已经支持签名上传和签名读取
- 已经能把 AI 资产引用收口为统一 `bucket + key`

当前实现的主要问题：

1. `local` 存储会生成 `localhost` 资源地址，不适合 AI 上游访问
2. `s3Provider` 名义上支持 S3 兼容，但实现还偏向 R2/MinIO
3. 目前没有把阿里 OSS 的限制单独处理
4. 环境变量设计过于简单，无法稳定覆盖三家差异
5. 上传、读取、AI 外链这三种 URL 目前没有严格区分

## 3. 三家厂商差异分析

### 3.1 火山引擎 TOS

官方文档显示，TOS 支持对象预签名 URL，也有标准 Endpoint 和自定义域名能力。

可以确认的点：

- 支持预签名 URL
- 支持自定义域名
- 文档中存在标准访问域名与 S3 Endpoint
- 适合和 CDN 组合

对当前项目的意义：

- 最适合优先接入
- 适合作为 AI 多模态图片、视频的外部访问源
- 适合未来再挂 CDN

官方参考：

- TOS 文档总览：<https://www.volcengine.com/docs/6349>
- TOS 预签名 URL：<https://www.volcengine.com/docs/6349/1844841>
- TOS 自定义域名：<https://www.volcengine.com/docs/6349/196438>
- TOS Endpoint：<https://www.volcengine.com/docs/6349/107356>
- TOS + CDN：<https://www.volcengine.com/docs/6454/1892947>

### 3.2 腾讯云 COS

腾讯官方文档明确说明 COS 提供兼容 S3 的 API，并给出了用 AWS S3 SDK 访问 COS 的方式。

可以确认的点：

- COS 支持 S3 兼容接入
- 兼容大部分第三方 S3 应用
- 初始化时需要显式设置 `region` 和 `endpoint`

对当前项目的意义：

- 当前 `s3Provider` 基本可以承接 COS
- 只要配置层足够清楚，不需要新写一个完整 provider

官方参考：

- COS 使用 AWS S3 SDK：<https://www.tencentcloud.com/document/product/436/32537>
- COS 第三方 S3 兼容配置：<https://www.tencentcloud.com/document/product/436/34688>

### 3.3 阿里云 OSS

阿里官方文档同样给出了“使用 AWS SDK 访问 OSS”的方式，但差异明显比 COS/TOS 大。

可以确认的点：

- OSS 支持一部分 S3 兼容接口
- OSS 仅支持 `virtual-hosted style`
- `path-style` 请求会被拒绝
- 文档明确指出中国内地新用户自 `2025-03-20` 起需要使用自定义域名 CNAME 才能对桶执行数据 API 操作
- 文档对分块上传、编码、处理能力也有单独限制

对当前项目的意义：

- 不能继续把 `forcePathStyle: true` 写死
- 不能把 OSS 当成“换个 endpoint 就能跑”
- 如果要稳定支持 OSS，必须把访问风格和公开域名抽象出来

官方参考：

- OSS 使用 AWS SDK：<https://www.alibabacloud.com/help/en/oss/developer-reference/use-aws-sdks-to-access-oss>
- OSS S3 兼容差异：<https://www.alibabacloud.com/help/en/oss/developer-reference/compatibility-with-amazon-s3>

## 4. 结论

从当前代码基础和三家官方差异来看，最合理的方向不是给每一家都写一套完全独立的存储实现，而是：

1. 保留统一 `StorageProvider` 接口
2. 把现有 `s3Provider` 升级成“通用对象存储 provider”
3. 用配置描述厂商差异，而不是让业务层判断
4. 仅在阿里 OSS 这类差异明显的位置做显式分支

一句话总结：

`业务层只认识 bucket / key / public url / signed url，厂商差异全部收进 provider 配置`

## 5. 设计目标

### 5.1 对业务层的目标

业务代码不应该关心：

- 当前是 TOS、COS 还是 OSS
- Endpoint 是什么格式
- 是否需要 path-style
- 是否必须走自定义域名

业务代码只关心：

- 上传文件
- 获取签名上传地址
- 获取签名读取地址
- 获取 AI 可访问的公网地址
- 删除文件

### 5.2 对存储层的目标

存储层需要支持四类 URL：

1. SDK 访问地址
2. 预签名上传地址
3. 预签名读取地址
4. 对外公开访问地址

这里最关键的一点是：

- 预签名读取地址不一定适合给 AI 上游长期使用
- AI 上游更适合拿“稳定可公网访问的资源地址”
- 因此需要把“读取签名 URL”和“AI 外部访问 URL”分开

## 6. 推荐架构

### 6.1 统一 provider 分层

建议把当前存储层收口为两层：

1. `ObjectStorageProvider`
2. `ObjectStorageProfile`

其中：

- `ObjectStorageProvider` 负责统一方法接口
- `ObjectStorageProfile` 负责描述当前厂商差异

推荐内部结构：

- `providerType`: `local | s3_compatible | oss`
- `vendor`: `tos | cos | oss | r2 | minio | generic`
- `endpoint`
- `region`
- `forcePathStyle`
- `publicBaseUrl`
- `preferPublicUrlForAI`
- `signedUrlExpires`
- `uploadUrlExpires`
- `defaultRetentionClass`

### 6.2 为什么保留 `oss` 单独类型

虽然阿里 OSS 可以用 AWS SDK 访问，但官方限制比其他两家严格：

- 只支持 virtual-hosted style
- 中国内地新用户要考虑 CNAME

所以推荐不是让业务层分支，而是在 provider 层保留：

- `s3_compatible`
- `oss`

其中：

- `tos` 和 `cos` 放在 `s3_compatible`
- `oss` 用单独 profile，必要时单独 provider

这样既不复杂，也能避免以后 OSS 适配越来越多时把通用 provider 弄脏。

## 7. 配置设计

### 7.1 当前环境变量问题

当前环境变量主要是：

- `STORAGE_PROVIDER`
- `STORAGE_ENDPOINT`
- `STORAGE_REGION`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`

这套配置对 R2/MinIO 足够，但对三家云厂商还不够。

### 7.2 推荐环境变量

建议统一成下面这套：

```env
STORAGE_PROVIDER=s3_compatible
STORAGE_VENDOR=tos
STORAGE_REGION=cn-beijing
STORAGE_ENDPOINT=https://tos-s3-cn-beijing.volces.com
STORAGE_ACCESS_KEY_ID=xxx
STORAGE_SECRET_ACCESS_KEY=xxx
STORAGE_FORCE_PATH_STYLE=true
STORAGE_BUCKET_NAME=nextdevtpl-uploads
NEXT_PUBLIC_AVATARS_BUCKET_NAME=avatars

# 外部访问地址
STORAGE_PUBLIC_BASE_URL=https://assets.example.com

# 预签名有效期
STORAGE_SIGNED_URL_EXPIRES=3600
STORAGE_UPLOAD_URL_EXPIRES=300

# AI 访问策略
STORAGE_AI_URL_MODE=public
```

如果接阿里 OSS：

```env
STORAGE_PROVIDER=oss
STORAGE_VENDOR=oss
STORAGE_REGION=cn-hangzhou
STORAGE_ENDPOINT=https://s3.oss-cn-hangzhou.aliyuncs.com
STORAGE_ACCESS_KEY_ID=xxx
STORAGE_SECRET_ACCESS_KEY=xxx
STORAGE_FORCE_PATH_STYLE=false
STORAGE_BUCKET_NAME=nextdevtpl-uploads
STORAGE_PUBLIC_BASE_URL=https://assets.example.com
STORAGE_AI_URL_MODE=public
```

如果接腾讯 COS：

```env
STORAGE_PROVIDER=s3_compatible
STORAGE_VENDOR=cos
STORAGE_REGION=ap-guangzhou
STORAGE_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com
STORAGE_ACCESS_KEY_ID=xxx
STORAGE_SECRET_ACCESS_KEY=xxx
STORAGE_FORCE_PATH_STYLE=false
STORAGE_BUCKET_NAME=nextdevtpl-uploads
STORAGE_PUBLIC_BASE_URL=https://assets.example.com
STORAGE_AI_URL_MODE=public
```

### 7.3 关键字段说明

| 字段 | 作用 |
|------|------|
| `STORAGE_PROVIDER` | 选择 provider 类型 |
| `STORAGE_VENDOR` | 标记厂商，便于特殊处理 |
| `STORAGE_FORCE_PATH_STYLE` | 控制 bucket 是否放在 path 中 |
| `STORAGE_PUBLIC_BASE_URL` | 统一对外访问域名 |
| `STORAGE_AI_URL_MODE` | 控制 AI 上游拿签名 URL 还是公网 URL |

## 8. 资源分级与生命周期设计

不能把所有资源都按“永久保存”处理。

推荐把资源分成三类：

### 8.1 长期资源

适用对象：

- 用户头像
- 用户主动上传并需要长期复用的商品图
- 平台结果归档
- 需要审计留痕的业务文件

特点：

- 默认不自动删除
- 可重复复用
- 适合配置 CDN 或公开访问域名

### 8.2 会话级临时资源

适用对象：

- AI 调用前处理中转文件
- 用户上传后仅在一段时间内需要分析的图片或视频
- 生成任务的中间产物

特点：

- 保存几小时到几天
- 到期自动删除
- 一般不需要长期回看

### 8.3 请求级短期资源

适用对象：

- 单次 AI 请求用到的临时图片和视频
- 重试几次后即可删除的中间文件
- 异步任务完成后不再需要的输入副本

特点：

- 保存几分钟到几小时
- 与 `requestId` 或 `taskId` 强绑定
- 请求结束或超时后即可删除

## 9. 生命周期策略

建议把保留策略统一成平台枚举，而不是散落在业务代码里。

推荐保留等级：

- `permanent`
- `long_term`
- `temporary`
- `ephemeral`

建议语义：

| 等级 | 建议保留时间 | 说明 |
|------|------|------|
| `permanent` | 不自动删除 | 核心长期资产 |
| `long_term` | 30 到 180 天 | 默认长期业务资源 |
| `temporary` | 1 到 7 天 | 会话级中间资源 |
| `ephemeral` | 10 分钟到 24 小时 | 请求级临时资源 |

删除策略建议分两层：

1. 平台主动清理
2. 云厂商生命周期规则兜底

推荐做法：

- `ephemeral`
  - 请求成功、失败或超时后即可删
- `temporary`
  - 超过保留时间自动删
  - 如需长期保留，再提升到长期路径
- `long_term`
  - 默认不主动删
  - 只在业务显式删除时处理

## 10. 资源元数据设计

为了支持长期和临时资源共存，建议不要只保留 `bucket + key`，而是增加最小元数据。

推荐字段：

- `bucket`
- `key`
- `contentType`
- `size`
- `ownerUserId`
- `toolKey`
- `purpose`
- `retentionClass`
- `expiresAt`
- `requestId`
- `taskId`
- `createdAt`

其中最关键的是：

- `purpose`
  - 例如 `avatar`、`product_image`、`result_archive`、`ai_input_temp`
- `retentionClass`
  - 决定清理策略
- `expiresAt`
  - 决定平台何时主动清理

## 11. 接口设计调整

### 8.1 保持当前 `StorageProvider` 主接口不变

当前接口已经够用，不需要大改：

- `getSignedUrl`
- `getSignedUploadUrl`
- `deleteObject`
- `putObject`
- `getObject`
- `listObjects`

### 8.2 新增一个方法

建议新增：

- `getPublicUrl(key, bucket): string`

用途：

- 前端展示图片
- AI 上游读取图片/音频/视频
- 外部工具直接拿到稳定地址

这样可以明确区分：

- `getSignedUrl`: 临时受控读取
- `getPublicUrl`: 稳定外部访问

### 8.3 建议再新增一个前缀删除能力

建议新增：

- `deletePrefix(prefix, bucket): Promise<void>`

用途：

- 删除某个 `requestId` 下的整组临时资源
- 删除某个 `taskId` 下的中间文件

如果第一版不想扩接口，也可以先用：

- `listObjects + deleteObject`

### 8.4 AI 网关必须改用公开地址

当前 AI 网关里：

- [`src/features/ai-gateway/service.ts`](/home/visus/code/tripsass/NextDevTpl/src/features/ai-gateway/service.ts)

`resolveStorageAssetUrl()` 现在直接走：

- `provider.getSignedUrl(key, bucket, 3600)`

这对本地存储和某些私网地址不稳定。

建议改成：

1. 如果 `STORAGE_AI_URL_MODE=public`，优先 `getPublicUrl`
2. 否则退回 `getSignedUrl`

这样后续图片、视频理解不会再把 `localhost` 发给上游模型。

## 12. Bucket 与路径规划

为了避免后续各种文件混在一起，建议统一保留一个主 bucket，再按路径分层。

推荐：

- `avatars/...`
- `redink/product-images/...`
- `redink/product-images-temp/...`
- `redink/product-videos/...`
- `redink/product-videos-temp/...`
- `redink/results/...`
- `jingfang-ai/uploads/...`
- `platform/ai-assets/request/{requestId}/...`
- `platform/ai-assets/task/{taskId}/...`
- `platform/results/...`

这样做的优点：

- 切存储厂商时不需要迁移 bucket 语义
- 权限策略和生命周期更容易按前缀控制
- 业务目录更清楚
- 长期和短期资源天然分层
- 便于给对象存储直接配置前缀生命周期规则

## 13. 上传策略

### 10.1 图片和视频统一走对象存储

后续建议：

- 所有图片上传统一走预签名上传
- 所有视频上传统一走预签名上传
- 大文件视频优先采用 multipart upload
- 上传时同步确定 `purpose` 和 `retentionClass`

### 10.2 为什么不继续走本地存储

原因很直接：

- 不适合多实例部署
- 不适合公网访问
- 不适合 AI 上游读取
- 不适合 CDN

本地存储只应保留给：

- 本地开发
- 自动化测试

### 13.3 上传时就确定资源保留等级

不要等业务完成后再猜这个文件是否应该长期保留。

建议上传接口一开始就带上：

- `purpose`
- `retentionClass`

例如：

- 商品主图：`product_image + long_term`
- AI 单次分析截图：`ai_input_temp + ephemeral`
- 视频生成任务中间文件：`video_task_temp + temporary`

## 14. 清理机制设计

推荐同时做三类清理：

### 14.1 请求完成后主动清理

适用：

- `ephemeral`
- 某些 `temporary`

触发时机：

- 请求成功
- 请求失败
- 请求超时
- 异步任务结束

### 14.2 定时清理

建议增加定时任务：

- 扫描 `expiresAt < now()` 的资源
- 删除对象存储文件
- 标记资源记录为已删除

### 14.3 云厂商生命周期规则兜底

建议在对象存储控制台配置前缀级生命周期：

- `platform/ai-assets/request/` 1 天
- `platform/ai-assets/task/` 3 天
- `redink/product-images-temp/` 7 天
- `redink/product-videos-temp/` 7 天

平台主动清理是主逻辑，云厂商生命周期是兜底逻辑。

## 15. 公开访问策略

推荐把“给 AI 使用的资源地址”和“管理后台临时读取地址”分开。

### 11.1 AI 访问

默认推荐：

- 私有桶
- 自定义域名
- 通过公开域名访问指定资源

如果需要更严：

- 用短期签名 URL
- 但 URL 必须是公网可访问域名，不能是内网或 localhost

### 11.2 后台读取

后台管理或用户回看时，仍可继续用：

- `getSignedUrl`

这样可以减少不必要的公开暴露。

## 16. 三家厂商的推荐接法

### 12.1 火山 TOS

推荐级别：最高

接法：

- 使用 `s3_compatible`
- `vendor=tos`
- 先不写专属 provider
- 配合 `STORAGE_PUBLIC_BASE_URL` 使用自定义域名或 CDN 域名

原因：

- 与现有代码最接近
- 适合图片和视频场景
- 适合 AI 外链

### 12.2 腾讯 COS

推荐级别：高

接法：

- 使用 `s3_compatible`
- `vendor=cos`
- `forcePathStyle` 做成可配置

原因：

- 官方明确支持 AWS S3 SDK
- 与当前 `s3Provider` 兼容度高

### 12.3 阿里 OSS

推荐级别：中高

接法：

- 保留 `oss` 独立 profile
- 第一版可以仍复用 AWS SDK
- 但必须显式要求：
  - `forcePathStyle=false`
  - 配置 `STORAGE_PUBLIC_BASE_URL`
  - 明确中国内地是否必须走 CNAME

原因：

- 差异比 COS/TOS 更大
- 若继续和通用 S3 逻辑完全混写，后面维护成本会上升

## 17. 推荐实施顺序

### Phase 1

- 把当前 `s3Provider` 改造成可配置 path-style 的通用 provider
- 增加 `getPublicUrl`
- 增加 `STORAGE_PUBLIC_BASE_URL`
- 增加 `STORAGE_AI_URL_MODE`
- 增加 `purpose / retentionClass / expiresAt` 的最小模型

### Phase 2

- 先接火山 TOS
- 把 `redink` 图片上传改到 TOS
- 把 AI 多模态资产 URL 改为公网访问 URL
- 把临时资源路径切到 `platform/ai-assets/request/` 等前缀

### Phase 3

- 验证 COS 兼容
- 确认 COS 的 endpoint、bucket、签名上传、签名读取都正常
- 增加定时清理任务

### Phase 4

- 加上 OSS profile
- 补 virtual-hosted style 约束
- 验证阿里 OSS 中国内地 CNAME 场景

状态：

- 已完成
- 当前结论是 CNAME 是否可用于生产，取决于证书与域名是否完全匹配；不匹配时仍应使用官方 bucket 域名

### Phase 5

- 将长期和临时资源策略固化到后台配置
- 按前缀配置云厂商生命周期规则
- 补齐任务结束后的主动删除

状态：

- 已完成主闭环
- 当前平台已具备后台策略、按前缀匹配、按 `requestId / taskId` 主动删除和定时清理
- “云厂商生命周期规则” 仍由后台输出规则模板和平台侧清理共同配合，未直接自动下发到云厂商控制台

## 18. 最终建议

最终推荐方案如下：

1. 保留统一存储接口，不让业务层感知厂商
2. 本地仅用于开发和测试，生产一律使用对象存储
3. 第一优先接火山 TOS
4. 第二优先兼容腾讯 COS
5. 阿里 OSS 通过独立 profile 处理其特殊限制
6. 所有图片和视频统一上传到对象存储
7. 资源必须区分长期、临时、超短期三类
8. AI 多模态读取统一使用公网可访问 URL，而不是 `localhost`
9. 平台主动清理和云厂商生命周期规则同时存在

一句话总结：

`把对象存储当成平台公共基础设施，同时把资源生命周期作为平台能力的一部分`

## 19. 本文参考

- 阿里云 OSS 使用 AWS SDK：<https://www.alibabacloud.com/help/en/oss/developer-reference/use-aws-sdks-to-access-oss>
- 阿里云 OSS S3 兼容差异：<https://www.alibabacloud.com/help/en/oss/developer-reference/compatibility-with-amazon-s3>
- 腾讯云 COS 使用 AWS S3 SDK：<https://www.tencentcloud.com/document/product/436/32537>
- 腾讯云 COS 第三方 S3 兼容配置：<https://www.tencentcloud.com/document/product/436/34688>
- 火山引擎 TOS 文档总览：<https://www.volcengine.com/docs/6349>
- 火山引擎 TOS 预签名 URL：<https://www.volcengine.com/docs/6349/1844841>
- 火山引擎 TOS Endpoint：<https://www.volcengine.com/docs/6349/107356>
- 火山引擎 TOS 自定义域名：<https://www.volcengine.com/docs/6349/196438>
- 火山引擎 TOS + CDN：<https://www.volcengine.com/docs/6454/1892947>
