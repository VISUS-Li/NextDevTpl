import type {
  AIBillingMode,
  AIRouteStrategy,
  ToolConfigFieldType,
} from "@/db/schema";
import type { ToolConfigValueInput } from "./schema";

export const DEFAULT_PROJECT_KEY = "nextdevtpl";
export const SLOT_CONFIG_COUNT = 10;
export const SLOT_SECRET_COUNT = 10;
export const SLOT_JSON_COUNT = 4;
export const SLOT_TEXT_COUNT = 4;

export type ToolStorageRuleDefinition = {
  prefix: string;
  purpose: string;
  retentionClass: "permanent" | "long_term" | "temporary" | "ephemeral";
  ttlHours: number;
  enabled: boolean;
  maxSizeBytes?: number | null;
  contentTypes?: string[] | null;
};

export type ToolFeaturePricingDefinition = {
  billingMode: AIBillingMode;
  minimumCredits: number;
  fixedCredits?: number;
  inputTokensPerCredit?: number;
  outputTokensPerCredit?: number;
};

export type ToolFeatureDefinition = {
  featureKey: string;
  name: string;
  description?: string;
  requestType: "chat";
  defaultOperation?: string;
  requiredCapabilities?: string[];
  enabled?: boolean;
  sortOrder?: number;
  pricing: ToolFeaturePricingDefinition;
};

export type ToolFieldOverrideDefinition = {
  settingLabel?: string;
  label?: string;
  description?: string;
  type?: ToolConfigFieldType;
  required?: boolean;
  adminOnly?: boolean;
  userOverridable?: boolean;
  defaultValueJson?: ToolConfigValueInput;
  optionsJson?: string[];
  validationJson?: Record<string, unknown>;
};

export type ToolDefinitionMetadata = {
  entry: {
    type: "internal_route" | "external_url" | "api_only";
    url: string;
  };
  runtimeMode: "none" | "platform_api" | "platform_ai" | "custom_adapter";
  authMode: "platform_session" | "launch_ticket";
  billingMode: "none" | "manual_credits" | "ai_gateway";
  storageMode: "none" | "platform_storage";
  capabilities: {
    adminConfig: boolean;
    userConfig: boolean;
    credits: boolean;
    ai: boolean;
    storage: boolean;
  };
};

export type BuiltInToolDefinition = {
  toolKey: string;
  name: string;
  description: string;
  sortOrder: number;
  metadata: ToolDefinitionMetadata;
  slotSettingLabels?: Record<string, string>;
  fieldOverrides?: Record<string, ToolFieldOverrideDefinition>;
  runtimeDefaults?: Partial<Record<string, ToolConfigValueInput>>;
  featureConfigDefaults?: Record<
    string,
    {
      enabled?: boolean;
      billingMode?: AIBillingMode;
      defaultCredits?: number;
      minimumCredits?: number;
    }
  >;
  features?: ToolFeatureDefinition[];
  storageRules?: ToolStorageRuleDefinition[];
  defaultAIRoute?: {
    requestedModel: string;
    routeStrategy: AIRouteStrategy;
    preferredProviderKey: string | null;
    allowedModels: string[];
    allowedProviderKeys: string[];
    assetUrlMode: "public" | "proxy" | "signed";
  };
};

const PLATFORM_REGISTRATION_BONUS = 200;

const STORAGE_RULES: ToolStorageRuleDefinition[] = [
  {
    prefix: "platform/ai-assets/request/",
    retentionClass: "ephemeral",
    ttlHours: 24,
    purpose: "ai_input_temp",
    enabled: true,
  },
  {
    prefix: "platform/ai-assets/task/",
    retentionClass: "temporary",
    ttlHours: 72,
    purpose: "ai_task_temp",
    enabled: true,
  },
];

const REDINK_STORAGE_RULES: ToolStorageRuleDefinition[] = [
  {
    prefix: "redink/product-images-temp/",
    retentionClass: "temporary",
    ttlHours: 168,
    purpose: "product_image_temp",
    enabled: true,
  },
  {
    prefix: "redink/product-videos-temp/",
    retentionClass: "temporary",
    ttlHours: 168,
    purpose: "product_video_temp",
    enabled: true,
  },
];

const REDINK_FEATURES: ToolFeatureDefinition[] = [
  {
    featureKey: "outline",
    name: "提纲生成",
    requestType: "chat",
    defaultOperation: "text.generate",
    requiredCapabilities: ["text"],
    pricing: {
      billingMode: "token_based",
      inputTokensPerCredit: 600,
      outputTokensPerCredit: 300,
      minimumCredits: 2,
    },
  },
  {
    featureKey: "content",
    name: "正文生成",
    requestType: "chat",
    defaultOperation: "text.generate",
    requiredCapabilities: ["text"],
    pricing: {
      billingMode: "token_based",
      inputTokensPerCredit: 600,
      outputTokensPerCredit: 300,
      minimumCredits: 2,
    },
  },
  {
    featureKey: "product-copy",
    name: "商品文案",
    requestType: "chat",
    defaultOperation: "text.generate",
    requiredCapabilities: ["text"],
    pricing: {
      billingMode: "token_based",
      inputTokensPerCredit: 600,
      outputTokensPerCredit: 300,
      minimumCredits: 2,
    },
  },
  {
    featureKey: "product-post-content",
    name: "商品帖子文案",
    requestType: "chat",
    defaultOperation: "text.generate",
    requiredCapabilities: ["text"],
    pricing: {
      billingMode: "token_based",
      inputTokensPerCredit: 600,
      outputTokensPerCredit: 300,
      minimumCredits: 2,
    },
  },
  {
    featureKey: "product-image-analysis",
    name: "商品图片理解",
    requestType: "chat",
    defaultOperation: "image.analyze",
    requiredCapabilities: ["text", "image_input"],
    pricing: {
      billingMode: "token_based",
      inputTokensPerCredit: 400,
      outputTokensPerCredit: 200,
      minimumCredits: 3,
    },
  },
  {
    featureKey: "product-post-image",
    name: "商品配图",
    requestType: "chat",
    defaultOperation: "image.generate",
    requiredCapabilities: ["image_generation"],
    pricing: {
      billingMode: "fixed_credits",
      fixedCredits: 8,
      minimumCredits: 8,
    },
  },
  {
    featureKey: "image-generation",
    name: "通用出图",
    requestType: "chat",
    defaultOperation: "image.generate",
    requiredCapabilities: ["image_generation"],
    pricing: {
      billingMode: "fixed_credits",
      fixedCredits: 8,
      minimumCredits: 8,
    },
  },
];

const REDINK_FEATURE_CONFIG_DEFAULTS = {
  rewrite: {
    enabled: true,
    billingMode: "fixed_credits" as const,
    defaultCredits: 3,
    minimumCredits: 3,
  },
  outline: {
    enabled: true,
    billingMode: "token_based" as const,
    minimumCredits: 2,
  },
  content: {
    enabled: true,
    billingMode: "token_based" as const,
    minimumCredits: 2,
  },
  "product-copy": {
    enabled: true,
    billingMode: "token_based" as const,
    minimumCredits: 2,
  },
  "product-post-content": {
    enabled: true,
    billingMode: "token_based" as const,
    minimumCredits: 2,
  },
  "product-image-analysis": {
    enabled: true,
    billingMode: "token_based" as const,
    minimumCredits: 3,
  },
  "product-post-image": {
    enabled: true,
    billingMode: "fixed_credits" as const,
    defaultCredits: 8,
    minimumCredits: 8,
  },
  "image-generation": {
    enabled: true,
    billingMode: "fixed_credits" as const,
    defaultCredits: 8,
    minimumCredits: 8,
  },
};

const REDINK_MODEL_CATALOG = {
  text_generation: {
    defaultModel: "gpt-4o-mini",
    options: [
      {
        modelKey: "gpt-4o-mini",
        label: "标准文案模型",
        description: "适合标题和正文生成",
      },
    ],
  },
  image_generation: {
    defaultModel: null,
    options: [],
  },
} as const;

// RedInk 的 4 类完整提示词模板由平台配置提供，运行时直接读取 text1~text4。
const REDINK_PROMPT_DEFAULTS = {
  text1: [
    "请分析用户上传的单张商品图片，并返回结构化 JSON。",
    "",
    "要求：",
    "1. 只输出 JSON",
    "2. 信息不确定时返回空字符串或空数组",
    "3. 尽量提取商品名称、类目、卖点、适用人群、使用场景、风格关键词和图片 OCR 文本",
    "",
    "JSON 结构：",
    "{{",
    '  "product_name": "商品名称",',
    '  "product_category": "商品类目",',
    '  "core_selling_points": ["卖点1", "卖点2"],',
    '  "target_people": "目标人群",',
    '  "usage_scenarios": ["场景1", "场景2"],',
    '  "style_keywords": ["关键词1", "关键词2"],',
    '  "ocr_text": "图片里的可识别文字",',
    '  "visual_summary": "对图片主体和风格的总结",',
    '  "user_notes": "结合用户补充信息后的备注"',
    "}}",
    "",
    "用户补充信息：",
    "{user_notes}",
  ].join("\n"),
  text2: [
    "你是一名小红书爆款文案助手。请基于下面的商品结构化信息，返回 JSON：",
    "",
    "{product_info_json}",
    "",
    "补充要求：",
    "- 生成 3 个标题候选",
    "- 正文要像真实分享，语气自然，有购买理由",
    "- 标签返回数组",
    "- 只输出 JSON",
    "",
    "JSON 结构：",
    "{{",
    '  "titles": ["标题1", "标题2", "标题3"],',
    '  "copywriting": "正文",',
    '  "tags": ["标签1", "标签2", "标签3"]',
    "}}",
    "",
    "用户补充要求：",
    "{extra_notes}",
  ].join("\n"),
  text3: [
    "你是小红书电商种草博主，请基于商品结构化信息生成可直接发布的内容草稿。",
    "",
    "商品信息：",
    "{product_info_json}",
    "",
    "要求：",
    "1. 生成 5 个小红书风格标题，标题要有表情符号，真实自然，避免硬广腔",
    "2. 生成 3 个小红书风格文案，每个文案 120-260 字，包含购买理由、使用场景和互动引导",
    "3. 生成 8-12 个标签，不要加 # 号",
    "4. 只输出 JSON",
    "",
    "JSON 结构：",
    "{{",
    '  "titles": ["标题1", "标题2", "标题3", "标题4", "标题5"],',
    '  "copywriting_options": ["文案1", "文案2", "文案3"],',
    '  "tags": ["标签1", "标签2", "标签3"]',
    "}}",
    "",
    "用户补充要求：",
    "{extra_notes}",
  ].join("\n"),
  text4: [
    "生成小红书风格商品发布图，竖版 3:4。",
    "",
    "必须保持参考图中的商品主体完全不变，包括外观、包装、颜色、品牌信息和可识别文字。",
    "可以增加符合小红书风格的生活化背景、自然光影、桌面陈列、贴纸感元素、手写风标题和轻微氛围装饰。",
    "不要出现小红书 logo、平台界面、水印、用户 ID、二维码。",
    "",
    "主标题参考：{title}",
    "商品名称：{product_name}",
    "商品类目：{product_category}",
    "核心卖点：{selling_points}",
    "使用场景：{usage_scenarios}",
    "视觉风格：{style_keywords}",
    "标签方向：{tags}",
    "文案提示词参考：{copy_prompt_template}",
    "已生成文案参考：{copywriting}",
    "用户补充：{extra_notes}",
  ].join("\n"),
} as const;

export const BUILT_IN_TOOL_DEFINITIONS: readonly BuiltInToolDefinition[] = [
  {
    toolKey: "platform",
    name: "tripai",
    description: "平台基础设置",
    sortOrder: 10,
    metadata: {
      entry: {
        type: "internal_route",
        url: "/admin/tool-config",
      },
      runtimeMode: "platform_api",
      authMode: "platform_session",
      billingMode: "none",
      storageMode: "none",
      capabilities: {
        adminConfig: true,
        userConfig: false,
        credits: false,
        ai: false,
        storage: false,
      },
    },
    slotSettingLabels: {
      config1: "新用户注册奖励积分",
    },
    fieldOverrides: {
      config1: {
        label: "platform.registrationBonusCredits",
        description: "新用户首次获得注册奖励时发放的积分数量",
        type: "number",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: PLATFORM_REGISTRATION_BONUS,
        validationJson: {
          min: 1,
          max: 100000,
        },
      },
    },
    runtimeDefaults: {
      config1: PLATFORM_REGISTRATION_BONUS,
    },
  },
  {
    toolKey: "storage",
    name: "Storage",
    description: "对象存储生命周期策略",
    sortOrder: 20,
    metadata: {
      entry: {
        type: "internal_route",
        url: "/admin/storage",
      },
      runtimeMode: "platform_api",
      authMode: "platform_session",
      billingMode: "none",
      storageMode: "platform_storage",
      capabilities: {
        adminConfig: true,
        userConfig: false,
        credits: false,
        ai: false,
        storage: true,
      },
    },
    slotSettingLabels: {
      config1: "短期资源保留小时",
      config2: "临时资源保留天数",
      config3: "长期资源保留天数",
      json1: "前缀生命周期规则",
    },
    fieldOverrides: {
      config1: {
        label: "storage.ephemeralHours",
        description: "请求级短期资源默认保留小时数",
        type: "number",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: 6,
      },
      config2: {
        label: "storage.temporaryDays",
        description: "会话级临时资源默认保留天数",
        type: "number",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: 3,
      },
      config3: {
        label: "storage.longTermDays",
        description: "长期资源默认保留天数",
        type: "number",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: 90,
      },
      json1: {
        label: "storage.prefixRules",
        description:
          "按对象前缀管理生命周期规则，供平台清理和云厂商生命周期配置参考",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: STORAGE_RULES.map((item) => ({ ...item })),
      },
    },
    runtimeDefaults: {
      config1: 6,
      config2: 3,
      config3: 90,
      json1: STORAGE_RULES.map((item) => ({ ...item })),
    },
  },
  {
    toolKey: "redink",
    name: "RedInk",
    description: "小红书内容工具",
    sortOrder: 30,
    metadata: {
      entry: {
        type: "internal_route",
        url: "/dashboard/tools/redink",
      },
      runtimeMode: "custom_adapter",
      authMode: "platform_session",
      billingMode: "ai_gateway",
      storageMode: "platform_storage",
      capabilities: {
        adminConfig: true,
        userConfig: true,
        credits: true,
        ai: true,
        storage: true,
      },
    },
    slotSettingLabels: {
      config1: "默认模型",
      config2: "路由策略",
      config3: "首选服务商",
      secret1: "自定义密钥",
      json1: "允许模型列表",
      json2: "功能规则",
      json3: "允许服务商列表",
      json4: "用户可见模型目录",
      config10: "AI 资源访问方式",
      text1: "商品图片理解提示词",
      text2: "商品文案生成提示词",
      text3: "商品发布文案提示词",
      text4: "商品发布图基础提示词",
    },
    fieldOverrides: {
      // 这些字段决定平台 AI 选模和路由，只允许管理员查看和修改。
      config1: {
        label: "redink.defaultModel",
        description: "RedInk 默认使用的文本模型键",
        adminOnly: true,
        userOverridable: false,
      },
      config2: {
        label: "redink.routeStrategy",
        description: "RedInk 调用 AI 网关时使用的路由策略",
        adminOnly: true,
        userOverridable: false,
      },
      config3: {
        label: "redink.preferredProvider",
        description: "RedInk 优先使用的服务商键",
        adminOnly: true,
        userOverridable: false,
      },
      config4: {
        label: "redink.config4",
        description: "RedInk 预留配置槽位 4，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      config5: {
        label: "redink.config5",
        description: "RedInk 预留配置槽位 5，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      config6: {
        label: "redink.config6",
        description: "RedInk 预留配置槽位 6，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      config7: {
        label: "redink.config7",
        description: "RedInk 预留配置槽位 7，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      config8: {
        label: "redink.config8",
        description: "RedInk 预留配置槽位 8，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      config9: {
        label: "redink.config9",
        description: "RedInk 预留配置槽位 9，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      config10: {
        label: "ai.assetUrlMode",
        description:
          "控制 AI 上游读取平台资源时走公开 OSS 地址还是平台代理地址",
        type: "select",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: "public",
        optionsJson: ["public", "proxy"],
      },
      secret1: {
        label: "redink.overrideApiKey",
        description: "仅管理员可用的上游服务密钥",
        adminOnly: true,
        userOverridable: false,
      },
      secret2: {
        label: "redink.secret2",
        description: "RedInk 预留密钥槽位 2，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret3: {
        label: "redink.secret3",
        description: "RedInk 预留密钥槽位 3，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret4: {
        label: "redink.secret4",
        description: "RedInk 预留密钥槽位 4，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret5: {
        label: "redink.secret5",
        description: "RedInk 预留密钥槽位 5，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret6: {
        label: "redink.secret6",
        description: "RedInk 预留密钥槽位 6，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret7: {
        label: "redink.secret7",
        description: "RedInk 预留密钥槽位 7，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret8: {
        label: "redink.secret8",
        description: "RedInk 预留密钥槽位 8，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret9: {
        label: "redink.secret9",
        description: "RedInk 预留密钥槽位 9，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      secret10: {
        label: "redink.secret10",
        description: "RedInk 预留密钥槽位 10，仅管理员可用",
        adminOnly: true,
        userOverridable: false,
      },
      json1: {
        label: "redink.allowedModels",
        description: "RedInk 允许调用的模型白名单",
        adminOnly: true,
        userOverridable: false,
      },
      json2: {
        label: "redink.featureRules",
        description: "RedInk 各功能的启用状态和计费规则",
        adminOnly: true,
        userOverridable: false,
      },
      json3: {
        label: "redink.allowedProviders",
        description: "RedInk 允许使用的服务商白名单",
        adminOnly: true,
        userOverridable: false,
      },
      json4: {
        label: "redink.userModelCatalog",
        description:
          "配置 RedInk 对用户展示的模型子集与别名，必须是 AI 网关模型绑定的子集",
        adminOnly: true,
        userOverridable: false,
      },
      // 用户侧只保留提示词类配置，用于个性化自己的生成偏好。
      text1: {
        label: "redink.productImageAnalysisPrompt",
        description: "完整模板，支持变量 {user_notes}，生成时按模板原样渲染",
        userOverridable: true,
        defaultValueJson: REDINK_PROMPT_DEFAULTS.text1,
      },
      text2: {
        label: "redink.productCopyPrompt",
        description:
          "完整模板，支持变量 {product_info_json} 和 {extra_notes}，生成时按模板原样渲染",
        userOverridable: true,
        defaultValueJson: REDINK_PROMPT_DEFAULTS.text2,
      },
      text3: {
        label: "redink.productPostPrompt",
        description:
          "完整模板，支持变量 {product_info_json} 和 {extra_notes}，生成时按模板原样渲染",
        userOverridable: true,
        defaultValueJson: REDINK_PROMPT_DEFAULTS.text3,
      },
      text4: {
        label: "redink.productPostImagePrompt",
        description:
          "完整模板，支持标题、商品信息、标签、文案和 {extra_notes} 等变量，生成时按模板原样渲染",
        userOverridable: true,
        defaultValueJson: REDINK_PROMPT_DEFAULTS.text4,
      },
    },
    runtimeDefaults: {
      config1: "gpt-4o-mini",
      config2: "primary_only",
      config3: "geek-default",
      json1: ["gpt-4o-mini"],
      json2: REDINK_FEATURE_CONFIG_DEFAULTS,
      json3: ["geek-default"],
      json4: REDINK_MODEL_CATALOG,
      text1: REDINK_PROMPT_DEFAULTS.text1,
      text2: REDINK_PROMPT_DEFAULTS.text2,
      text3: REDINK_PROMPT_DEFAULTS.text3,
      text4: REDINK_PROMPT_DEFAULTS.text4,
    },
    featureConfigDefaults: REDINK_FEATURE_CONFIG_DEFAULTS,
    features: REDINK_FEATURES,
    storageRules: REDINK_STORAGE_RULES,
    defaultAIRoute: {
      requestedModel: "gpt-4o-mini",
      routeStrategy: "primary_only",
      preferredProviderKey: "geek-default",
      allowedModels: ["gpt-4o-mini"],
      allowedProviderKeys: ["geek-default"],
      assetUrlMode: "public",
    },
  },
  {
    toolKey: "jingfang-ai",
    name: "Jingfang AI",
    description: "警方案件内容工具",
    sortOrder: 40,
    metadata: {
      entry: {
        type: "external_url",
        url: "https://jingfang.tripai.icu",
      },
      runtimeMode: "platform_api",
      authMode: "launch_ticket",
      billingMode: "manual_credits",
      storageMode: "platform_storage",
      capabilities: {
        adminConfig: true,
        userConfig: true,
        credits: true,
        ai: false,
        storage: true,
      },
    },
    slotSettingLabels: {
      config1: "聊天平台",
      config2: "火山存储空间名",
      config3: "语音识别 App ID",
      config4: "语音识别 App Type",
      config5: "豆包视觉 Endpoint",
      config6: "火山区域 Region",
      config10: "AI 资源访问方式",
      secret1: "主聊天 API Key",
      secret2: "云雾 API Key",
      secret3: "火山 Access Key ID",
      secret4: "火山 Secret Access Key",
      secret5: "语音识别 Access Token",
      secret6: "高级设置密码",
    },
    fieldOverrides: {
      config10: {
        label: "ai.assetUrlMode",
        description:
          "控制 AI 上游读取平台资源时走公开 OSS 地址还是平台代理地址",
        type: "select",
        adminOnly: true,
        userOverridable: false,
        defaultValueJson: "public",
        optionsJson: ["public", "proxy"],
      },
    },
  },
] as const;

/**
 * 返回内置工具定义快照。
 */
export function listBuiltInToolDefinitions() {
  return BUILT_IN_TOOL_DEFINITIONS.map((item) => ({
    ...item,
    metadata: structuredClone(item.metadata),
    slotSettingLabels: item.slotSettingLabels
      ? { ...item.slotSettingLabels }
      : undefined,
    fieldOverrides: item.fieldOverrides
      ? structuredClone(item.fieldOverrides)
      : undefined,
    runtimeDefaults: item.runtimeDefaults
      ? structuredClone(item.runtimeDefaults)
      : undefined,
    featureConfigDefaults: item.featureConfigDefaults
      ? structuredClone(item.featureConfigDefaults)
      : undefined,
    features: item.features ? structuredClone(item.features) : undefined,
    storageRules: item.storageRules
      ? structuredClone(item.storageRules)
      : undefined,
    defaultAIRoute: item.defaultAIRoute
      ? structuredClone(item.defaultAIRoute)
      : undefined,
  }));
}

/**
 * 按工具键读取单个内置工具定义。
 */
export function getBuiltInToolDefinition(toolKey: string) {
  return listBuiltInToolDefinitions().find((item) => item.toolKey === toolKey);
}

/**
 * 读取工具功能定义列表。
 */
export function listBuiltInToolFeatures(toolKey: string) {
  return getBuiltInToolDefinition(toolKey)?.features ?? [];
}

/**
 * 读取工具存储规则列表。
 */
export function listBuiltInToolStorageRules(toolKey: string) {
  return getBuiltInToolDefinition(toolKey)?.storageRules ?? [];
}
