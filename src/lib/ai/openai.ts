import OpenAI from "openai";

/**
 * AI 提供商类型
 */
export type AIProvider = "openai" | "deepseek" | "mimo";

/**
 * AI 调用配置
 */
export interface AIConfig {
  provider?: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * AI 使用量信息
 */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * AI 聊天结果
 */
export interface AIChatResult {
  content: string;
  model: string;
  responseId: string | null;
  usage: AIUsage;
  raw: OpenAI.Chat.Completions.ChatCompletion;
}

/**
 * 获取当前配置的 AI 提供商
 */
export function getAIProvider(config?: AIConfig): AIProvider {
  return config?.provider || (process.env.AI_PROVIDER as AIProvider) || "openai";
}

/**
 * 获取 AI 模型名称
 */
export function getAIModel(config?: AIConfig): string {
  if (config?.model) {
    return config.model;
  }
  const provider = getAIProvider(config);
  if (provider === "deepseek") {
    return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }
  if (provider === "mimo") {
    return process.env.MIMO_MODEL || "mimo-v2-flash";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function getOpenAIGatewayConfig(): {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
} {
  const token = process.env.CF_AIG_TOKEN;
  const baseURL = process.env.CF_AIG_BASE_URL;
  if (!token || !baseURL) return {};

  return {
    baseURL,
    defaultHeaders: {
      "cf-aig-authorization": `Bearer ${token}`,
    },
  };
}

/**
 * OpenAI 客户端实例
 */
const openaiGatewayConfig = getOpenAIGatewayConfig();
const useOpenAIGateway =
  !!process.env.CF_AIG_TOKEN && !!process.env.CF_AIG_BASE_URL;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...openaiGatewayConfig,
});

/**
 * DeepSeek 客户端实例（使用 OpenAI 兼容模式）
 */
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

/**
 * 小米 MiMo 客户端实例（使用 OpenAI 兼容模式）
 */
const mimo = new OpenAI({
  apiKey: process.env.MIMO_API_KEY,
  baseURL: useOpenAIGateway
    ? openaiGatewayConfig.baseURL
    : "https://api.xiaomimimo.com/v1",
  ...(useOpenAIGateway
    ? { defaultHeaders: openaiGatewayConfig.defaultHeaders }
    : {}),
});

/**
 * 获取当前活跃的 AI 客户端
 */
function getAIClient(config?: AIConfig): OpenAI {
  if (config) {
    return createAIClient(config);
  }

  const provider = getAIProvider();
  if (provider === "deepseek") return deepseek;
  if (provider === "mimo") return mimo;
  return openai;
}

/**
 * 按传入配置创建 AI 客户端
 */
export function createAIClient(config: AIConfig): OpenAI {
  const provider = getAIProvider(config);
  if (provider === "deepseek") {
    return new OpenAI({
      apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY,
      baseURL: config.baseUrl ?? "https://api.deepseek.com/v1",
    });
  }
  if (provider === "mimo") {
    return new OpenAI({
      apiKey: config.apiKey ?? process.env.MIMO_API_KEY,
      baseURL:
        config.baseUrl ??
        (useOpenAIGateway
          ? openaiGatewayConfig.baseURL
          : "https://api.xiaomimimo.com/v1"),
      ...(useOpenAIGateway && !config.baseUrl
        ? { defaultHeaders: openaiGatewayConfig.defaultHeaders }
        : {}),
    });
  }

  return new OpenAI({
    apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
    ...(config.baseUrl
      ? { baseURL: config.baseUrl }
      : getOpenAIGatewayConfig()),
  });
}

/**
 * 通用 Chat Completion 调用
 *
 * 模板示例：封装了 provider 切换逻辑，可直接用于业务调用
 *
 * @param messages - 聊天消息列表
 * @param options - 可选参数（temperature、max_tokens、json mode 等）
 * @returns AI 返回的文本内容
 */
export async function chatCompletion(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    aiConfig?: AIConfig;
  }
): Promise<string> {
  const client = getAIClient(options?.aiConfig);
  const model = getAIModel(options?.aiConfig);

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    ...(options?.jsonMode && { response_format: { type: "json_object" } }),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    const providerNames: Record<AIProvider, string> = {
      openai: "OpenAI",
      deepseek: "DeepSeek",
      mimo: "MiMo",
    };
    throw new Error(
      `No response from ${providerNames[getAIProvider(options?.aiConfig)]}`
    );
  }

  return content;
}

/**
 * 通用 Chat Completion 调用，并返回 usage 等完整信息。
 *
 * 这层给 AI 网关使用，便于做成本统计和计费。
 */
export async function chatCompletionWithUsage(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    aiConfig?: AIConfig;
  }
): Promise<AIChatResult> {
  const client = getAIClient(options?.aiConfig);
  const model = getAIModel(options?.aiConfig);

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    ...(options?.jsonMode && { response_format: { type: "json_object" } }),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    const providerNames: Record<AIProvider, string> = {
      openai: "OpenAI",
      deepseek: "DeepSeek",
      mimo: "MiMo",
    };
    throw new Error(
      `No response from ${providerNames[getAIProvider(options?.aiConfig)]}`
    );
  }

  return {
    content,
    model: response.model,
    responseId: response.id ?? null,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
    raw: response,
  };
}

export { openai, deepseek, mimo, getAIClient };
