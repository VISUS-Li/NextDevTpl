import {
  sql,
} from "drizzle-orm";
import {
  boolean,
  integer,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Better Auth 核心表 Schema
 *
 * 这些表是 Better Auth 认证系统所必需的核心表结构
 * 参考: https://www.better-auth.com/docs/concepts/database
 */

// ============================================
// 用户角色枚举
// ============================================

/**
 * 用户角色枚举
 */
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// ============================================
// 用户表 (User)
// ============================================
/**
 * 用户表 - 存储用户基本信息
 *
 * @field id - 用户唯一标识符
 * @field name - 用户显示名称
 * @field email - 用户邮箱 (唯一)
 * @field emailVerified - 邮箱是否已验证
 * @field image - 用户头像 URL
 * @field role - 用户角色 (user/admin)
 * @field banned - 是否被封禁
 * @field bannedReason - 封禁原因
 * @field customerId - 支付提供商客户 ID
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  bannedReason: text("banned_reason"),
  // 兼容当前数据库中的历史列名
  customerId: text("stripe_customer_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 会话表 (Session)
// ============================================
/**
 * 会话表 - 存储用户登录会话
 *
 * @field id - 会话唯一标识符
 * @field expiresAt - 会话过期时间
 * @field token - 会话令牌 (用于验证)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 * @field ipAddress - 登录 IP 地址
 * @field userAgent - 用户代理 (浏览器信息)
 * @field userId - 关联的用户 ID
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// ============================================
// 账户表 (Account)
// ============================================
/**
 * 账户表 - 存储 OAuth 提供商关联信息
 *
 * 当用户使用 GitHub、Google 等第三方登录时，
 * 此表存储该提供商的账户信息
 *
 * @field id - 账户唯一标识符
 * @field accountId - 提供商返回的账户 ID
 * @field providerId - 提供商标识符 (如 "github", "google")
 * @field userId - 关联的用户 ID
 * @field accessToken - 访问令牌
 * @field refreshToken - 刷新令牌
 * @field idToken - ID 令牌 (OpenID Connect)
 * @field accessTokenExpiresAt - 访问令牌过期时间
 * @field refreshTokenExpiresAt - 刷新令牌过期时间
 * @field scope - 授权范围
 * @field password - 密码哈希 (用于邮箱密码登录)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 验证表 (Verification)
// ============================================
/**
 * 验证表 - 存储邮箱验证和密码重置令牌
 *
 * @field id - 验证记录唯一标识符
 * @field identifier - 标识符 (通常是邮箱地址)
 * @field value - 验证值/令牌
 * @field expiresAt - 过期时间
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 项目工具配置枚举
// ============================================

/**
 * 工具配置字段类型枚举
 */
export const toolConfigFieldTypeEnum = pgEnum("tool_config_field_type", [
  "string",
  "textarea",
  "number",
  "boolean",
  "select",
  "json",
  "secret",
]);

/**
 * 工具配置值作用域枚举
 */
export const toolConfigScopeEnum = pgEnum("tool_config_scope", [
  "project_admin",
  "user",
]);

/**
 * 工具配置审计动作枚举
 */
export const toolConfigAuditActionEnum = pgEnum("tool_config_audit_action", [
  "create",
  "update",
  "clear",
]);

// ============================================
// 项目工具配置表
// ============================================

/**
 * 项目表 - 存储可接入工具配置的业务项目
 */
export const project = pgTable("project", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  configRevision: integer("config_revision").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 工具注册表 - 记录项目可使用的工具
 */
export const toolRegistry = pgTable(
  "tool_registry",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    toolKey: text("tool_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tool_registry_project_tool_key_idx").on(
      table.projectId,
      table.toolKey
    ),
  ]
);

/**
 * 工具配置字段定义表 - 存储工具可配置字段
 */
export const toolConfigField = pgTable(
  "tool_config_field",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    toolKey: text("tool_key").notNull(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    group: text("group").notNull().default("tool"),
    type: toolConfigFieldTypeEnum("type").notNull(),
    required: boolean("required").notNull().default(false),
    adminOnly: boolean("admin_only").notNull().default(false),
    userOverridable: boolean("user_overridable").notNull().default(false),
    defaultValueJson: json("default_value_json").$type<unknown>(),
    optionsJson: json("options_json").$type<unknown>(),
    validationJson: json("validation_json").$type<Record<string, unknown>>(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tool_config_field_project_tool_field_idx").on(
      table.projectId,
      table.toolKey,
      table.fieldKey
    ),
  ]
);

/**
 * 工具配置值表 - 存储管理员配置和用户配置
 */
export const toolConfigValue = pgTable(
  "tool_config_value",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    toolKey: text("tool_key").notNull(),
    fieldKey: text("field_key").notNull(),
    scope: toolConfigScopeEnum("scope").notNull(),
    userId: text("user_id"),
    valueJson: json("value_json").$type<unknown>(),
    encryptedValue: text("encrypted_value"),
    secretSet: boolean("secret_set").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tool_config_value_project_admin_idx")
      .on(table.projectId, table.toolKey, table.fieldKey, table.scope)
      .where(sql`${table.scope} = 'project_admin'`),
    uniqueIndex("tool_config_value_user_idx")
      .on(table.projectId, table.toolKey, table.fieldKey, table.scope, table.userId)
      .where(sql`${table.scope} = 'user'`),
  ]
);

/**
 * 工具配置审计表 - 记录配置字段变更行为
 */
export const toolConfigAuditLog = pgTable("tool_config_audit_log", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  toolKey: text("tool_key").notNull(),
  fieldKey: text("field_key").notNull(),
  scope: toolConfigScopeEnum("scope").notNull(),
  userId: text("user_id"),
  actorId: text("actor_id"),
  action: toolConfigAuditActionEnum("action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 对象存储资源表
// ============================================

/**
 * 对象存储保留等级枚举
 */
export const storageRetentionClassEnum = pgEnum("storage_retention_class", [
  "permanent",
  "long_term",
  "temporary",
  "ephemeral",
]);

/**
 * 对象存储资源状态枚举
 */
export const storageObjectStatusEnum = pgEnum("storage_object_status", [
  "pending",
  "ready",
  "deleted",
]);

/**
 * 对象存储资源表
 *
 * 用于记录上传对象的用途、保留等级和过期时间。
 */
export const storageObject = pgTable(
  "storage_object",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size"),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    toolKey: text("tool_key"),
    purpose: text("purpose").notNull(),
    retentionClass: storageRetentionClassEnum("retention_class")
      .notNull()
      .default("long_term"),
    expiresAt: timestamp("expires_at"),
    requestId: text("request_id"),
    taskId: text("task_id"),
    status: storageObjectStatusEnum("status").notNull().default("pending"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("storage_object_bucket_key_idx").on(table.bucket, table.key),
  ]
);

// ============================================
// RedInk 发布草稿表
// ============================================
/**
 * RedInk 发布草稿表 - 存储用户选择的标题、文案、标签和图片元数据
 */
export const redinkDraft = pgTable("redink_draft", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  productInfo: json("product_info").$type<Record<string, unknown>>().notNull(),
  sourceAsset: json("source_asset").$type<Record<string, unknown>>(),
  selectedTitle: text("selected_title").notNull(),
  selectedCopywriting: text("selected_copywriting").notNull(),
  tags: json("tags").$type<string[]>().notNull(),
  imagePrompt: text("image_prompt").notNull(),
  selectedImages: json("selected_images")
    .$type<Array<Record<string, unknown>>>()
    .notNull(),
  status: text("status").notNull().default("draft"),
  publishResult: json("publish_result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 订阅表 (Subscription)
// ============================================
/**
 * 订阅表 - 存储用户的订阅信息
 *
 * @field id - 订阅记录唯一标识符
 * @field userId - 关联的用户 ID
 * @field subscriptionId - 支付提供商订阅 ID (唯一)
 * @field priceId - 支付提供商价格/产品 ID
 * @field status - 订阅状态 (active, canceled, past_due, etc.)
 * @field currentPeriodStart - 当前计费周期开始时间
 * @field currentPeriodEnd - 当前计费周期结束时间
 * @field cancelAtPeriodEnd - 是否在周期结束时取消
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // 兼容当前数据库中的历史列名
  subscriptionId: text("stripe_subscription_id").notNull().unique(),
  priceId: text("stripe_price_id").notNull(),
  status: text("status").notNull().default("incomplete"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 统一订单中心枚举
// ============================================

/**
 * 订单支付提供商枚举
 */
export const salesOrderProviderEnum = pgEnum("sales_order_provider", [
  "creem",
  "wechat_pay",
  "alipay",
]);

/**
 * 订单类型枚举
 */
export const salesOrderTypeEnum = pgEnum("sales_order_type", [
  "subscription",
  "credit_purchase",
]);

/**
 * 订单状态枚举
 */
export const salesOrderStatusEnum = pgEnum("sales_order_status", [
  "pending",
  "paid",
  "confirmed",
  "closed",
]);

/**
 * 订单售后状态枚举
 */
export const salesAfterSalesStatusEnum = pgEnum("sales_after_sales_status", [
  "none",
  "partial_refund",
  "refunded",
  "returned",
  "chargeback",
]);

/**
 * 售后事件类型枚举
 */
export const salesAfterSalesEventTypeEnum = pgEnum(
  "sales_after_sales_event_type",
  ["partial_refund", "refunded", "returned", "chargeback"]
);

/**
 * 佣金规则状态枚举
 */
export const commissionRuleStatusEnum = pgEnum("commission_rule_status", [
  "active",
  "inactive",
]);

/**
 * 佣金计算方式枚举
 */
export const commissionCalculationModeEnum = pgEnum(
  "commission_calculation_mode",
  ["rate", "fixed"]
);

/**
 * 佣金事件状态枚举
 */
export const commissionEventStatusEnum = pgEnum("commission_event_status", [
  "pending",
  "completed",
  "skipped",
]);

/**
 * 佣金记录状态枚举
 */
export const commissionRecordStatusEnum = pgEnum("commission_record_status", [
  "frozen",
  "available",
  "reversed",
  "withdrawn",
]);

/**
 * 佣金账本类型枚举
 */
export const commissionLedgerEntryTypeEnum = pgEnum(
  "commission_ledger_entry_type",
  [
    "commission_frozen",
    "commission_available",
    "commission_reverse",
    "withdraw_freeze",
    "withdraw_release",
    "withdraw_paid",
    "manual_adjustment",
  ]
);

/**
 * 佣金账本方向枚举
 */
export const commissionLedgerDirectionEnum = pgEnum(
  "commission_ledger_direction",
  ["credit", "debit"]
);

/**
 * 提现申请状态枚举
 */
export const withdrawalRequestStatusEnum = pgEnum("withdrawal_request_status", [
  "pending",
  "approved",
  "rejected",
  "paid",
  "failed",
]);

/**
 * 订单项商品类型枚举
 */
export const salesOrderItemProductTypeEnum = pgEnum(
  "sales_order_item_product_type",
  ["subscription", "credit_package"]
);

// ============================================
// 统一订单表 (Sales Orders)
// ============================================
/**
 * 统一订单表 - 记录支付成功后的统一订单事件
 *
 * 这一层先服务于 webhook 落单与后续分销接入
 */
export const salesOrder = pgTable("sales_order", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: salesOrderProviderEnum("provider").notNull(),
  providerOrderId: text("provider_order_id"),
  providerCheckoutId: text("provider_checkout_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  providerPaymentId: text("provider_payment_id"),
  orderType: salesOrderTypeEnum("order_type").notNull(),
  status: salesOrderStatusEnum("status").notNull().default("paid"),
  afterSalesStatus: salesAfterSalesStatusEnum("after_sales_status")
    .notNull()
    .default("none"),
  currency: text("currency").notNull(),
  grossAmount: integer("gross_amount").notNull().default(0),
  paidAt: timestamp("paid_at"),
  eventTime: timestamp("event_time").notNull(),
  eventType: text("event_type").notNull(),
  eventIdempotencyKey: text("event_idempotency_key").notNull().unique(),
  referralCode: text("referral_code"),
  attributedAgentUserId: text("attributed_agent_user_id").references(
    () => user.id,
    { onDelete: "set null" }
  ),
  attributionId: text("attribution_id"),
  attributionSnapshot: json("attribution_snapshot").$type<
    Record<string, unknown>
  >(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 统一订单项表 (Sales Order Items)
// ============================================
/**
 * 统一订单项表 - 记录订单中的具体商品明细
 */
export const salesOrderItem = pgTable("sales_order_item", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => salesOrder.id, { onDelete: "cascade" }),
  productType: salesOrderItemProductTypeEnum("product_type").notNull(),
  productId: text("product_id"),
  priceId: text("price_id"),
  planId: text("plan_id"),
  quantity: integer("quantity").notNull().default(1),
  grossAmount: integer("gross_amount").notNull().default(0),
  netAmount: integer("net_amount").notNull().default(0),
  commissionBaseAmount: integer("commission_base_amount").notNull().default(0),
  refundedAmount: integer("refunded_amount").notNull().default(0),
  refundableAmount: integer("refundable_amount").notNull().default(0),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 统一售后事件表 (Sales After Sales Events)
// ============================================
/**
 * 售后事件表 - 记录退款、退货、拒付等售后变更
 */
export const salesAfterSalesEvent = pgTable("sales_after_sales_event", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => salesOrder.id, { onDelete: "cascade" }),
  orderItemId: text("order_item_id").references(() => salesOrderItem.id, {
    onDelete: "set null",
  }),
  eventType: salesAfterSalesEventTypeEnum("event_type").notNull(),
  eventIdempotencyKey: text("event_idempotency_key").notNull().unique(),
  providerEventId: text("provider_event_id"),
  amount: integer("amount").notNull().default(0),
  currency: text("currency").notNull(),
  reason: text("reason"),
  eventTime: timestamp("event_time").notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 佣金规则表 (Commission Rule)
// ============================================
/**
 * 佣金规则表 - 定义当前支持的分佣规则
 */
export const commissionRule = pgTable("commission_rule", {
  id: text("id").primaryKey(),
  status: commissionRuleStatusEnum("status").notNull().default("active"),
  orderType: salesOrderTypeEnum("order_type"),
  productType: salesOrderItemProductTypeEnum("product_type"),
  commissionLevel: integer("commission_level").notNull().default(1),
  calculationMode: commissionCalculationModeEnum("calculation_mode")
    .notNull()
    .default("rate"),
  rate: integer("rate"),
  fixedAmount: integer("fixed_amount"),
  freezeDays: integer("freeze_days").notNull().default(7),
  appliesToFirstPurchase: boolean("applies_to_first_purchase")
    .notNull()
    .default(true),
  appliesToRenewal: boolean("applies_to_renewal").notNull().default(false),
  appliesToCreditPackage: boolean("applies_to_credit_package")
    .notNull()
    .default(false),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 佣金事件表 (Commission Event)
// ============================================
/**
 * 佣金事件表 - 记录某个订单项触发了一次分佣执行
 */
export const commissionEvent = pgTable("commission_event", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => salesOrder.id, { onDelete: "cascade" }),
  orderItemId: text("order_item_id")
    .notNull()
    .references(() => salesOrderItem.id, { onDelete: "cascade" }),
  triggerUserId: text("trigger_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(),
  status: commissionEventStatusEnum("status").notNull().default("pending"),
  currency: text("currency").notNull(),
  commissionBaseAmount: integer("commission_base_amount").notNull().default(0),
  settlementBasis: text("settlement_basis"),
  ruleSnapshot: json("rule_snapshot").$type<Record<string, unknown>>(),
  attributionSnapshot: json("attribution_snapshot").$type<
    Record<string, unknown>
  >(),
  errorMessage: text("error_message"),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 佣金记录表 (Commission Record)
// ============================================
/**
 * 佣金记录表 - 记录代理应得的单条佣金
 */
export const commissionRecord = pgTable("commission_record", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => commissionEvent.id, { onDelete: "cascade" }),
  beneficiaryUserId: text("beneficiary_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sourceAgentUserId: text("source_agent_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  commissionLevel: integer("commission_level").notNull().default(1),
  ruleId: text("rule_id").references(() => commissionRule.id, {
    onDelete: "set null",
  }),
  ruleSnapshot: json("rule_snapshot").$type<Record<string, unknown>>(),
  amount: integer("amount").notNull().default(0),
  currency: text("currency").notNull(),
  status: commissionRecordStatusEnum("status").notNull().default("frozen"),
  availableAt: timestamp("available_at"),
  reversedAt: timestamp("reversed_at"),
  reversalReason: text("reversal_reason"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 佣金余额表 (Commission Balance)
// ============================================
/**
 * 佣金余额表 - 记录代理佣金余额快照
 */
export const commissionBalance = pgTable("commission_balance", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  currency: text("currency").notNull(),
  totalEarned: integer("total_earned").notNull().default(0),
  availableAmount: integer("available_amount").notNull().default(0),
  frozenAmount: integer("frozen_amount").notNull().default(0),
  withdrawnAmount: integer("withdrawn_amount").notNull().default(0),
  reversedAmount: integer("reversed_amount").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 佣金账本表 (Commission Ledger)
// ============================================
/**
 * 佣金账本表 - 记录佣金余额如何变化
 */
export const commissionLedger = pgTable("commission_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  recordId: text("record_id").references(() => commissionRecord.id, {
    onDelete: "set null",
  }),
  entryType: commissionLedgerEntryTypeEnum("entry_type").notNull(),
  direction: commissionLedgerDirectionEnum("direction").notNull(),
  amount: integer("amount").notNull().default(0),
  beforeBalance: integer("before_balance").notNull().default(0),
  afterBalance: integer("after_balance").notNull().default(0),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  memo: text("memo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 提现申请表 (Withdrawal Request)
// ============================================
/**
 * 提现申请表 - 记录代理提现申请与审核状态
 */
export const withdrawalRequest = pgTable("withdrawal_request", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull().default(0),
  feeAmount: integer("fee_amount").notNull().default(0),
  netAmount: integer("net_amount").notNull().default(0),
  currency: text("currency").notNull(),
  status: withdrawalRequestStatusEnum("status").notNull().default("pending"),
  payeeSnapshot: json("payee_snapshot").$type<Record<string, unknown>>(),
  operatorUserId: text("operator_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  operatorNote: text("operator_note"),
  reviewedAt: timestamp("reviewed_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 分销归因枚举
// ============================================

/**
 * 代理资料状态枚举
 */
export const distributionProfileStatusEnum = pgEnum(
  "distribution_profile_status",
  ["active", "inactive"]
);

/**
 * 推广码状态枚举
 */
export const distributionReferralCodeStatusEnum = pgEnum(
  "distribution_referral_code_status",
  ["active", "inactive"]
);

// ============================================
// 分销代理资料表 (Distribution Profile)
// ============================================
/**
 * 分销代理资料表 - 存储代理关系与展示信息
 */
export const distributionProfile = pgTable("distribution_profile", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  status: distributionProfileStatusEnum("status").notNull().default("active"),
  agentLevel: text("agent_level"),
  displayName: text("display_name"),
  inviterUserId: text("inviter_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  path: text("path"),
  depth: integer("depth").notNull().default(0),
  boundAt: timestamp("bound_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 推广码表 (Distribution Referral Code)
// ============================================
/**
 * 推广码表 - 存储代理的推广码与入口配置
 */
export const distributionReferralCode = pgTable("distribution_referral_code", {
  id: text("id").primaryKey(),
  agentUserId: text("agent_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  campaign: text("campaign"),
  landingPath: text("landing_path"),
  status: distributionReferralCodeStatusEnum("status")
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 归因快照表 (Distribution Attribution)
// ============================================
/**
 * 归因快照表 - 记录用户在 Checkout 前绑定到哪个代理
 */
export const distributionAttribution = pgTable("distribution_attribution", {
  id: text("id").primaryKey(),
  visitorKey: text("visitor_key"),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  agentUserId: text("agent_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  referralCode: text("referral_code").notNull(),
  campaign: text("campaign"),
  landingPath: text("landing_path"),
  source: text("source"),
  boundReason: text("bound_reason"),
  boundAt: timestamp("bound_at").notNull(),
  expiresAt: timestamp("expires_at"),
  snapshot: json("snapshot").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 类型导出
// ============================================
/**
 * 从 Schema 推断的类型
 * 用于在应用中保持类型安全
 */
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;

export type ToolRegistry = typeof toolRegistry.$inferSelect;
export type NewToolRegistry = typeof toolRegistry.$inferInsert;

export type ToolConfigField = typeof toolConfigField.$inferSelect;
export type NewToolConfigField = typeof toolConfigField.$inferInsert;

export type ToolConfigValue = typeof toolConfigValue.$inferSelect;
export type NewToolConfigValue = typeof toolConfigValue.$inferInsert;

export type ToolConfigAuditLog = typeof toolConfigAuditLog.$inferSelect;
export type NewToolConfigAuditLog = typeof toolConfigAuditLog.$inferInsert;

export type ToolConfigFieldType =
  (typeof toolConfigFieldTypeEnum.enumValues)[number];

export type ToolConfigScope = (typeof toolConfigScopeEnum.enumValues)[number];

export type ToolConfigAuditAction =
  (typeof toolConfigAuditActionEnum.enumValues)[number];

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;

export type SalesOrder = typeof salesOrder.$inferSelect;
export type NewSalesOrder = typeof salesOrder.$inferInsert;

export type SalesOrderItem = typeof salesOrderItem.$inferSelect;
export type NewSalesOrderItem = typeof salesOrderItem.$inferInsert;

export type SalesAfterSalesEvent = typeof salesAfterSalesEvent.$inferSelect;
export type NewSalesAfterSalesEvent = typeof salesAfterSalesEvent.$inferInsert;

export type CommissionRule = typeof commissionRule.$inferSelect;
export type NewCommissionRule = typeof commissionRule.$inferInsert;

export type CommissionEvent = typeof commissionEvent.$inferSelect;
export type NewCommissionEvent = typeof commissionEvent.$inferInsert;

export type CommissionRecord = typeof commissionRecord.$inferSelect;
export type NewCommissionRecord = typeof commissionRecord.$inferInsert;

export type CommissionBalance = typeof commissionBalance.$inferSelect;
export type NewCommissionBalance = typeof commissionBalance.$inferInsert;

export type CommissionLedger = typeof commissionLedger.$inferSelect;
export type NewCommissionLedger = typeof commissionLedger.$inferInsert;

export type WithdrawalRequest = typeof withdrawalRequest.$inferSelect;
export type NewWithdrawalRequest = typeof withdrawalRequest.$inferInsert;

export type SalesOrderProvider =
  (typeof salesOrderProviderEnum.enumValues)[number];

export type SalesOrderType = (typeof salesOrderTypeEnum.enumValues)[number];

export type SalesOrderStatus = (typeof salesOrderStatusEnum.enumValues)[number];

export type SalesAfterSalesStatus =
  (typeof salesAfterSalesStatusEnum.enumValues)[number];

export type SalesOrderItemProductType =
  (typeof salesOrderItemProductTypeEnum.enumValues)[number];

export type SalesAfterSalesEventType =
  (typeof salesAfterSalesEventTypeEnum.enumValues)[number];

export type CommissionRuleStatus =
  (typeof commissionRuleStatusEnum.enumValues)[number];

export type CommissionCalculationMode =
  (typeof commissionCalculationModeEnum.enumValues)[number];

export type CommissionEventStatus =
  (typeof commissionEventStatusEnum.enumValues)[number];

export type CommissionRecordStatus =
  (typeof commissionRecordStatusEnum.enumValues)[number];

export type CommissionLedgerEntryType =
  (typeof commissionLedgerEntryTypeEnum.enumValues)[number];

export type CommissionLedgerDirection =
  (typeof commissionLedgerDirectionEnum.enumValues)[number];

export type WithdrawalRequestStatus =
  (typeof withdrawalRequestStatusEnum.enumValues)[number];

export type DistributionProfile = typeof distributionProfile.$inferSelect;
export type NewDistributionProfile = typeof distributionProfile.$inferInsert;

export type DistributionReferralCode =
  typeof distributionReferralCode.$inferSelect;
export type NewDistributionReferralCode =
  typeof distributionReferralCode.$inferInsert;

export type DistributionAttribution =
  typeof distributionAttribution.$inferSelect;
export type NewDistributionAttribution =
  typeof distributionAttribution.$inferInsert;

export type DistributionProfileStatus =
  (typeof distributionProfileStatusEnum.enumValues)[number];

export type DistributionReferralCodeStatus =
  (typeof distributionReferralCodeStatusEnum.enumValues)[number];

// ============================================
// 积分系统枚举
// ============================================

/**
 * 积分账户状态枚举
 */
export const creditsBalanceStatusEnum = pgEnum("credits_balance_status", [
  "active",
  "frozen",
]);

/**
 * 积分批次状态枚举
 */
export const creditsBatchStatusEnum = pgEnum("credits_batch_status", [
  "active",
  "consumed",
  "expired",
]);

/**
 * 积分批次来源类型枚举
 */
export const creditsBatchSourceEnum = pgEnum("credits_batch_source", [
  "purchase",
  "subscription",
  "bonus",
  "refund",
]);

/**
 * 积分交易类型枚举
 */
export const creditsTransactionTypeEnum = pgEnum("credits_transaction_type", [
  "purchase",
  "consumption",
  "monthly_grant",
  "registration_bonus",
  "admin_grant",
  "expiration",
  "refund",
]);

// ============================================
// 积分余额表 (Credits Balances)
// ============================================
/**
 * 积分余额表 - 存储用户的积分账户信息
 *
 * 采用预计算余额模式，避免每次查询都需要聚合计算
 *
 * @field id - 记录唯一标识符
 * @field userId - 关联的用户 ID（唯一）
 * @field balance - 当前可用积分余额
 * @field totalEarned - 累计获得积分
 * @field totalSpent - 累计消费积分
 * @field status - 账户状态（active/frozen）
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const creditsBalance = pgTable("credits_balance", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  totalEarned: integer("total_earned").notNull().default(0),
  totalSpent: integer("total_spent").notNull().default(0),
  status: creditsBalanceStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 积分批次表 (Credits Batches)
// ============================================
/**
 * 积分批次表 - 积分库存管理
 *
 * 每次获得积分都会创建一个批次记录
 * 用于实现 FIFO (先进先出) 过期机制
 *
 * @field id - 批次唯一标识符
 * @field userId - 关联的用户 ID
 * @field amount - 原始积分数量
 * @field remaining - 剩余积分数量
 * @field issuedAt - 发放时间
 * @field expiresAt - 过期时间（可为空，表示永不过期）
 * @field status - 批次状态（active/consumed/expired）
 * @field sourceType - 来源类型（purchase/subscription/bonus/refund）
 * @field sourceRef - 来源引用（如订单ID、订阅ID等）
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const creditsBatch = pgTable("credits_batch", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  remaining: integer("remaining").notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  status: creditsBatchStatusEnum("status").notNull().default("active"),
  sourceType: creditsBatchSourceEnum("source_type").notNull(),
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 积分交易表 (Credits Transactions)
// ============================================
/**
 * 积分交易表 - 双重记账账本
 *
 * 记录所有积分变动，采用借贷记账法
 * 每笔交易都有明确的借方(debit)和贷方(credit)账户
 *
 * @field id - 交易唯一标识符
 * @field userId - 关联的用户 ID
 * @field type - 交易类型
 * @field amount - 交易积分数量（始终为正数）
 * @field debitAccount - 借方账户（资金来源）
 * @field creditAccount - 贷方账户（资金去向）
 * @field description - 交易描述
 * @field metadata - 扩展元数据（JSON）
 * @field createdAt - 创建时间
 */
export const creditsTransaction = pgTable("credits_transaction", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: creditsTransactionTypeEnum("type").notNull(),
  amount: integer("amount").notNull(),
  debitAccount: text("debit_account").notNull(),
  creditAccount: text("credit_account").notNull(),
  description: text("description"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 积分系统类型导出
// ============================================

export type CreditsBalance = typeof creditsBalance.$inferSelect;
export type NewCreditsBalance = typeof creditsBalance.$inferInsert;

export type CreditsBatch = typeof creditsBatch.$inferSelect;
export type NewCreditsBatch = typeof creditsBatch.$inferInsert;

export type CreditsTransaction = typeof creditsTransaction.$inferSelect;
export type NewCreditsTransaction = typeof creditsTransaction.$inferInsert;

/** 积分账户状态类型 */
export type CreditsBalanceStatus =
  (typeof creditsBalanceStatusEnum.enumValues)[number];

/** 积分批次状态类型 */
export type CreditsBatchStatus =
  (typeof creditsBatchStatusEnum.enumValues)[number];

/** 积分批次来源类型 */
export type CreditsBatchSource =
  (typeof creditsBatchSourceEnum.enumValues)[number];

/** 积分交易类型 */
export type CreditsTransactionType =
  (typeof creditsTransactionTypeEnum.enumValues)[number];

// ============================================
// AI 网关枚举
// ============================================

/**
 * AI 请求类型枚举
 */
export const aiRequestTypeEnum = pgEnum("ai_request_type", ["chat"]);

/**
 * AI 中转站类型枚举
 */
export const aiRelayProviderTypeEnum = pgEnum("ai_relay_provider_type", [
  "openai_compatible",
]);

/**
 * AI 中转站健康状态枚举
 */
export const aiRelayProviderHealthStatusEnum = pgEnum(
  "ai_relay_provider_health_status",
  ["unknown", "healthy", "degraded", "down"]
);

/**
 * AI 计费模式枚举
 */
export const aiBillingModeEnum = pgEnum("ai_billing_mode", [
  "fixed_credits",
  "token_based",
  "cost_plus",
]);

/**
 * AI 请求状态枚举
 */
export const aiRequestStatusEnum = pgEnum("ai_request_status", [
  "pending",
  "success",
  "failed",
  "insufficient_credits",
  "billing_failed",
]);

/**
 * AI 请求尝试状态枚举
 */
export const aiRequestAttemptStatusEnum = pgEnum("ai_request_attempt_status", [
  "success",
  "failed",
  "timeout",
  "rejected",
]);

/**
 * AI 结算状态枚举
 */
export const aiBillingRecordStatusEnum = pgEnum("ai_billing_record_status", [
  "charged",
  "skipped",
  "reversed",
]);

/**
 * AI 路由策略枚举
 */
export const aiRouteStrategyEnum = pgEnum("ai_route_strategy", [
  "primary_only",
  "priority_failover",
  "weighted",
]);

/**
 * AI 成本计算模式枚举
 */
export const aiRelayCostModeEnum = pgEnum("ai_relay_cost_mode", [
  "manual",
  "fixed",
]);

// ============================================
// AI 网关表
// ============================================

/**
 * AI 中转站表 - 存储可调用的上游中转站
 */
export const aiRelayProvider = pgTable("ai_relay_provider", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  providerType: aiRelayProviderTypeEnum("provider_type")
    .notNull()
    .default("openai_compatible"),
  baseUrl: text("base_url").notNull(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(100),
  weight: integer("weight").notNull().default(100),
  requestType: aiRequestTypeEnum("request_type").notNull().default("chat"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  lastHealthAt: timestamp("last_health_at"),
  lastHealthStatus: aiRelayProviderHealthStatusEnum("last_health_status")
    .notNull()
    .default("unknown"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * AI 模型绑定表 - 存储平台模型与上游模型映射
 */
export const aiRelayModelBinding = pgTable(
  "ai_relay_model_binding",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => aiRelayProvider.id, { onDelete: "cascade" }),
    modelKey: text("model_key").notNull(),
    modelAlias: text("model_alias").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    weight: integer("weight").notNull().default(100),
    costMode: aiRelayCostModeEnum("cost_mode").notNull().default("manual"),
    inputCostPer1k: integer("input_cost_per_1k_micros").notNull().default(0),
    outputCostPer1k: integer("output_cost_per_1k_micros").notNull().default(0),
    fixedCostUsd: integer("fixed_cost_micros").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(0),
    timeoutMs: integer("timeout_ms").notNull().default(30000),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_relay_model_binding_provider_model_idx").on(
      table.providerId,
      table.modelKey
    ),
  ]
);

/**
 * AI 计费规则表 - 存储工具功能计费规则
 */
export const aiPricingRule = pgTable(
  "ai_pricing_rule",
  {
    id: text("id").primaryKey(),
    toolKey: text("tool_key").notNull(),
    featureKey: text("feature_key").notNull(),
    requestType: aiRequestTypeEnum("request_type").notNull().default("chat"),
    billingMode: aiBillingModeEnum("billing_mode").notNull(),
    modelScope: text("model_scope").notNull().default("any"),
    fixedCredits: integer("fixed_credits"),
    inputTokensPerCredit: integer("input_tokens_per_credit"),
    outputTokensPerCredit: integer("output_tokens_per_credit"),
    costUsdPerCredit: integer("cost_usd_per_credit_micros"),
    minimumCredits: integer("minimum_credits").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_pricing_rule_tool_feature_request_idx").on(
      table.toolKey,
      table.featureKey,
      table.requestType,
      table.modelScope
    ),
  ]
);

/**
 * AI 请求日志表 - 记录平台视角的一次 AI 请求
 */
export const aiRequestLog = pgTable("ai_request_log", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  toolKey: text("tool_key").notNull(),
  featureKey: text("feature_key").notNull(),
  requestType: aiRequestTypeEnum("request_type").notNull().default("chat"),
  requestedModel: text("requested_model"),
  resolvedModel: text("resolved_model"),
  routeStrategy: aiRouteStrategyEnum("route_strategy")
    .notNull()
    .default("priority_failover"),
  status: aiRequestStatusEnum("status").notNull().default("pending"),
  billingMode: aiBillingModeEnum("billing_mode").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  providerCostUsd: integer("provider_cost_micros"),
  chargedCredits: integer("charged_credits"),
  attemptCount: integer("attempt_count").notNull().default(0),
  winningAttemptNo: integer("winning_attempt_no"),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestBody: json("request_body").$type<Record<string, unknown>>(),
  responseMeta: json("response_meta").$type<Record<string, unknown>>(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * AI 请求尝试表 - 记录一次平台请求的每次上游尝试
 */
export const aiRequestAttempt = pgTable(
  "ai_request_attempt",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => aiRequestLog.requestId, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    providerId: text("provider_id").references(() => aiRelayProvider.id, {
      onDelete: "set null",
    }),
    providerKey: text("provider_key").notNull(),
    modelKey: text("model_key").notNull(),
    modelAlias: text("model_alias").notNull(),
    status: aiRequestAttemptStatusEnum("status").notNull(),
    httpStatus: integer("http_status"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    providerCostUsd: integer("provider_cost_micros"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    requestMeta: json("request_meta").$type<Record<string, unknown>>(),
    responseMeta: json("response_meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_request_attempt_request_attempt_idx").on(
      table.requestId,
      table.attemptNo
    ),
  ]
);

/**
 * AI 结算记录表 - 关联 AI 请求与积分交易
 */
export const aiBillingRecord = pgTable("ai_billing_record", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => aiRequestLog.requestId, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  billingMode: aiBillingModeEnum("billing_mode").notNull(),
  chargedCredits: integer("charged_credits").notNull().default(0),
  creditsTransactionId: text("credits_transaction_id").references(
    () => creditsTransaction.id,
    { onDelete: "set null" }
  ),
  status: aiBillingRecordStatusEnum("status").notNull().default("charged"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// AI 网关类型导出
// ============================================

export type AIRelayProvider = typeof aiRelayProvider.$inferSelect;
export type NewAIRelayProvider = typeof aiRelayProvider.$inferInsert;

export type AIRelayModelBinding = typeof aiRelayModelBinding.$inferSelect;
export type NewAIRelayModelBinding = typeof aiRelayModelBinding.$inferInsert;

export type AIPricingRule = typeof aiPricingRule.$inferSelect;
export type NewAIPricingRule = typeof aiPricingRule.$inferInsert;

export type AIRequestLog = typeof aiRequestLog.$inferSelect;
export type NewAIRequestLog = typeof aiRequestLog.$inferInsert;

export type AIRequestAttempt = typeof aiRequestAttempt.$inferSelect;
export type NewAIRequestAttempt = typeof aiRequestAttempt.$inferInsert;

export type AIBillingRecord = typeof aiBillingRecord.$inferSelect;
export type NewAIBillingRecord = typeof aiBillingRecord.$inferInsert;

export type AIRequestType = (typeof aiRequestTypeEnum.enumValues)[number];
export type AIRelayProviderType =
  (typeof aiRelayProviderTypeEnum.enumValues)[number];
export type AIRelayProviderHealthStatus =
  (typeof aiRelayProviderHealthStatusEnum.enumValues)[number];
export type AIBillingMode = (typeof aiBillingModeEnum.enumValues)[number];
export type AIRequestStatus = (typeof aiRequestStatusEnum.enumValues)[number];
export type AIRequestAttemptStatus =
  (typeof aiRequestAttemptStatusEnum.enumValues)[number];
export type AIBillingRecordStatus =
  (typeof aiBillingRecordStatusEnum.enumValues)[number];
export type AIRouteStrategy = (typeof aiRouteStrategyEnum.enumValues)[number];
export type AIRelayCostMode = (typeof aiRelayCostModeEnum.enumValues)[number];
export type StorageObject = typeof storageObject.$inferSelect;
export type NewStorageObject = typeof storageObject.$inferInsert;
export type StorageRetentionClass =
  (typeof storageRetentionClassEnum.enumValues)[number];
export type StorageObjectStatus =
  (typeof storageObjectStatusEnum.enumValues)[number];

// ============================================
// Newsletter 订阅表
// ============================================
/**
 * Newsletter 订阅者表 - 存储邮件订阅信息
 *
 * @field id - 记录唯一标识符
 * @field email - 订阅者邮箱 (唯一)
 * @field isSubscribed - 是否订阅中 (用于取消订阅而不删除记录)
 * @field subscribedAt - 订阅时间
 * @field unsubscribedAt - 取消订阅时间 (可为空)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const newsletterSubscriber = pgTable("newsletter_subscriber", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  isSubscribed: boolean("is_subscribed").notNull().default(true),
  subscribedAt: timestamp("subscribed_at").notNull().defaultNow(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// Newsletter 类型导出
// ============================================

export type NewsletterSubscriber = typeof newsletterSubscriber.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscriber.$inferInsert;

// ============================================
// 工单系统枚举
// ============================================

/**
 * 工单类别枚举
 */
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "billing",
  "technical",
  "bug",
  "feature",
  "other",
]);

/**
 * 工单优先级枚举
 */
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
]);

/**
 * 工单状态枚举
 */
export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

// ============================================
// 工单表 (Tickets)
// ============================================
/**
 * 工单表 - 存储用户支持工单
 *
 * @field id - 工单唯一标识符
 * @field userId - 创建工单的用户 ID
 * @field subject - 工单主题
 * @field category - 工单类别 (billing/technical/bug/feature/other)
 * @field priority - 优先级 (low/medium/high)
 * @field status - 状态 (open/in_progress/resolved/closed)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const ticket = pgTable("ticket", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  category: ticketCategoryEnum("category").notNull().default("other"),
  priority: ticketPriorityEnum("priority").notNull().default("medium"),
  status: ticketStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 工单消息表 (Ticket Messages)
// ============================================
/**
 * 工单消息表 - 存储工单对话记录
 *
 * @field id - 消息唯一标识符
 * @field ticketId - 关联的工单 ID
 * @field userId - 发送者用户 ID
 * @field content - 消息内容
 * @field isAdminResponse - 是否为管理员回复 (用于 UI 样式区分)
 * @field createdAt - 创建时间
 */
export const ticketMessage = pgTable("ticket_message", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => ticket.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isAdminResponse: boolean("is_admin_response").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 工单系统类型导出
// ============================================

export type Ticket = typeof ticket.$inferSelect;
export type NewTicket = typeof ticket.$inferInsert;

export type TicketMessage = typeof ticketMessage.$inferSelect;
export type NewTicketMessage = typeof ticketMessage.$inferInsert;

/** 用户角色类型 */
export type UserRole = (typeof userRoleEnum.enumValues)[number];

/** 工单类别类型 */
export type TicketCategory = (typeof ticketCategoryEnum.enumValues)[number];

/** 工单优先级类型 */
export type TicketPriority = (typeof ticketPriorityEnum.enumValues)[number];

/** 工单状态类型 */
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];
