import OpenAI from "openai";

/**
 * AI 提供商类型
 */
export type AIProvider = "openai" | "deepseek" | "mimo";

/**
 * 上游调用端点类型。
 */
export type AIEndpointType =
  | "chat_completions"
  | "images_generations"
  | "images_edits"
  | "videos_generations";

/**
 * 上游任务轮询类型。
 */
export type AIPollType = "chat" | "image" | "video";

/**
 * 平台内部 AI 操作类型。
 */
export type AIOperation =
  | "text.generate"
  | "image.understand"
  | "image.generate"
  | "image.edit"
  | "video.understand"
  | "video.generate"
  | "audio.understand"
  | "audio.generate"
  | "file.understand";

/**
 * AI 调用配置
 */
export interface AIConfig {
  provider?: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  endpointType?: AIEndpointType | undefined;
  pollType?: AIPollType | undefined;
  operation?: AIOperation | undefined;
}

/**
 * 图片细节等级
 */
export type AIImageDetail = "auto" | "low" | "high";

/**
 * 平台内部统一的消息角色
 */
export type AIMessageRole = "system" | "user" | "assistant";

/**
 * 文本消息片段
 */
export interface AITextPart {
  type: "text";
  text: string;
}

/**
 * 图片 URL 片段
 */
export interface AIImageUrlPart {
  type: "image_url";
  imageUrl: string;
  detail?: AIImageDetail | undefined;
}

/**
 * 平台内图片资产片段
 */
export interface AIImageAssetPart {
  type: "image_asset";
  bucket: string;
  key: string;
  detail?: AIImageDetail | undefined;
}

/**
 * 音频 URL 片段
 */
export interface AIAudioUrlPart {
  type: "audio_url";
  audioUrl: string;
  format?: string | undefined;
}

/**
 * 平台内音频资产片段
 */
export interface AIAudioAssetPart {
  type: "audio_asset";
  bucket: string;
  key: string;
  format?: string | undefined;
}

/**
 * 视频 URL 片段
 */
export interface AIVideoUrlPart {
  type: "video_url";
  videoUrl: string;
}

/**
 * 平台内视频资产片段
 */
export interface AIVideoAssetPart {
  type: "video_asset";
  bucket: string;
  key: string;
}

/**
 * 平台内通用文件资产片段
 */
export interface AIFileAssetPart {
  type: "file_asset";
  bucket: string;
  key: string;
  filename?: string | undefined;
  mimeType?: string | undefined;
}

/**
 * 平台统一输入片段
 */
export type AIInputPart =
  | AITextPart
  | AIImageUrlPart
  | AIImageAssetPart
  | AIAudioUrlPart
  | AIAudioAssetPart
  | AIVideoUrlPart
  | AIVideoAssetPart
  | AIFileAssetPart;

/**
 * 平台统一消息结构
 */
export interface AIChatMessage {
  role: AIMessageRole;
  content: string | AIInputPart[];
}

/**
 * 音频输出结构
 */
export interface AIAudioOutput {
  id?: string | null | undefined;
  data?: string | null | undefined;
  expiresAt?: number | null | undefined;
  transcript?: string | null | undefined;
}

/**
 * 平台统一输出结构
 */
export interface AIOutput {
  text?: string | undefined;
  image?: string | null | undefined;
  images?: Array<{ url: string }> | undefined;
  video?: string | null | undefined;
  audio?: AIAudioOutput | null | undefined;
}

/**
 * 平台统一任务结构
 */
export interface AITaskState {
  id: string;
  status: string;
}

/**
 * 发给上游的 provider 消息结构。
 */
export interface AIProviderMessage {
  role: AIMessageRole;
  content: string | Array<Record<string, unknown>>;
}

/**
 * AI 使用量信息
 */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  textInputTokens?: number | undefined;
  imageInputTokens?: number | undefined;
  audioInputTokens?: number | undefined;
  videoInputTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  cachedTokens?: number | undefined;
  billedUnits?: number | undefined;
}

/**
 * AI 聊天结果
 */
export interface AIChatResult {
  content: string;
  model: string;
  responseId: string | null;
  status?: string;
  usage: AIUsage;
  output?: AIOutput;
  task?: AITaskState | null;
  raw: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>;
}

/**
 * 通用 Chat 请求选项
 */
export interface AIChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  aiConfig?: AIConfig;
  extraBody?: Record<string, unknown>;
}

/**
 * 获取当前配置的 AI 提供商
 */
export function getAIProvider(config?: AIConfig): AIProvider {
  return (
    config?.provider || (process.env.AI_PROVIDER as AIProvider) || "openai"
  );
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
  messages: AIProviderMessage[],
  options?: AIChatOptions
): Promise<string> {
  const client = getAIClient(options?.aiConfig);
  const model = getAIModel(options?.aiConfig);

  const response = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.ChatCompletionMessageParam[],
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    ...(options?.jsonMode && { response_format: { type: "json_object" } }),
    ...(options?.extraBody ?? {}),
  });

  const content = getResponseText(response);
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
  messages: AIProviderMessage[],
  options?: AIChatOptions
): Promise<AIChatResult> {
  const endpointType = resolveEndpointType(
    options?.aiConfig,
    options?.extraBody
  );
  if (endpointType === "images_generations") {
    return await imageGenerationWithUsage(messages, options);
  }
  if (endpointType === "images_edits") {
    return await imageEditWithUsage(messages, options);
  }
  if (endpointType === "videos_generations") {
    return await videoGenerationWithUsage(messages, options);
  }

  const client = getAIClient(options?.aiConfig);
  const model = getAIModel(options?.aiConfig);

  const response = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.ChatCompletionMessageParam[],
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    ...(options?.jsonMode && { response_format: { type: "json_object" } }),
    ...(options?.extraBody ?? {}),
  });

  const content = getResponseText(response);
  const output = getResponseOutput(response);
  const task = getTaskState(response);
  if (!content && !output.image && !output.video && !output.audio && !task) {
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
    status: getResponseStatus(response),
    usage: getUsage(response),
    output,
    task,
    raw: response,
  };
}

async function imageGenerationWithUsage(
  messages: AIProviderMessage[],
  options?: AIChatOptions
): Promise<AIChatResult> {
  const requestConfig = getResolvedRequestConfig(options?.aiConfig);
  const prompt = extractImageGenerationPrompt(messages);
  const inputImages = extractImageInputs(messages);
  if (!prompt) {
    throw new Error("Image generation prompt is required");
  }

  const response = await fetch(`${requestConfig.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestConfig.apiKey
        ? { Authorization: `Bearer ${requestConfig.apiKey}` }
        : {}),
      ...(requestConfig.defaultHeaders ?? {}),
    },
    body: JSON.stringify({
      model: requestConfig.model,
      prompt,
      ...(inputImages.length === 1
        ? { image: inputImages[0] }
        : inputImages.length > 1
          ? { image: inputImages }
          : {}),
      ...(isRecord(options?.extraBody?.image) ? options?.extraBody?.image : {}),
      response_format: "url",
      n: 1,
      async: readAsyncFlag(options?.extraBody),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${response.status} status code (${(await response.text()) || "no body"})`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const data = Array.isArray(payload.data) ? payload.data : [];
  const firstItem = isRecord(data[0]) ? data[0] : null;
  const outputImage = asOptionalString(firstItem?.url);
  const taskId = asOptionalString(payload.task_id);
  const taskStatus = asOptionalString(payload.task_status);
  const usage = isRecord(payload.usage) ? payload.usage : {};

  return {
    content: asOptionalString(firstItem?.revised_prompt) ?? "",
    model: asOptionalString(payload.model) ?? requestConfig.model,
    responseId: taskId,
    status: taskStatus ?? "completed",
    usage: {
      promptTokens: asOptionalNumber(usage.input_tokens) ?? 0,
      completionTokens: asOptionalNumber(usage.output_tokens) ?? 0,
      totalTokens: asOptionalNumber(usage.total_tokens) ?? 0,
    },
    output: outputImage
      ? {
          image: outputImage,
          images: [{ url: outputImage }],
        }
      : {},
    task:
      taskId && taskStatus && taskStatus !== "succeed"
        ? {
            id: taskId,
            status: normalizeTaskStatus(taskStatus),
          }
        : null,
    raw: payload,
  };
}

async function imageEditWithUsage(
  messages: AIProviderMessage[],
  options?: AIChatOptions
): Promise<AIChatResult> {
  const requestConfig = getResolvedRequestConfig(options?.aiConfig);
  const prompt = extractImageGenerationPrompt(messages);
  const inputImages = extractImageInputs(messages);
  if (!prompt) {
    throw new Error("Image edit prompt is required");
  }
  if (inputImages.length === 0) {
    throw new Error("Image edit requires at least one input image");
  }

  const imageOptions = isRecord(options?.extraBody?.image)
    ? options?.extraBody?.image
    : {};
  const response = await fetch(`${requestConfig.baseUrl}/images/edits`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestConfig.apiKey
        ? { Authorization: `Bearer ${requestConfig.apiKey}` }
        : {}),
      ...(requestConfig.defaultHeaders ?? {}),
    },
    body: JSON.stringify({
      model: requestConfig.model,
      prompt,
      image: inputImages.length === 1 ? inputImages[0] : inputImages,
      ...(typeof imageOptions.mask === "string"
        ? { mask: imageOptions.mask }
        : {}),
      ...(typeof imageOptions.size === "string"
        ? { size: imageOptions.size }
        : {}),
      ...(typeof imageOptions.n === "number" ? { n: imageOptions.n } : {}),
      ...(typeof imageOptions.quality === "string"
        ? { quality: imageOptions.quality }
        : {}),
      ...(typeof imageOptions.response_format === "string"
        ? { response_format: imageOptions.response_format }
        : { response_format: "url" }),
      ...(typeof imageOptions.output_format === "string"
        ? { output_format: imageOptions.output_format }
        : {}),
      ...(typeof imageOptions.retries === "number"
        ? { retries: imageOptions.retries }
        : {}),
      ...(readBackgroundValue(options?.extraBody)
        ? { background: readBackgroundValue(options?.extraBody) }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${response.status} status code (${(await response.text()) || "no body"})`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeImageTaskPayload(payload, requestConfig.model);
}

async function videoGenerationWithUsage(
  messages: AIProviderMessage[],
  options?: AIChatOptions
): Promise<AIChatResult> {
  const requestConfig = getResolvedRequestConfig(options?.aiConfig);
  const prompt = extractImageGenerationPrompt(messages);
  if (!prompt) {
    throw new Error("Video generation prompt is required");
  }

  const videoOptions = isRecord(options?.extraBody?.video)
    ? options?.extraBody?.video
    : {};
  const imageInputs = extractImageInputs(messages);
  const videoInputs = extractVideoInputs(messages);
  const response = await fetch(`${requestConfig.baseUrl}/videos/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestConfig.apiKey
        ? { Authorization: `Bearer ${requestConfig.apiKey}` }
        : {}),
      ...(requestConfig.defaultHeaders ?? {}),
    },
    body: JSON.stringify({
      model: requestConfig.model,
      prompt,
      ...(typeof videoOptions.negative_prompt === "string"
        ? { negative_prompt: videoOptions.negative_prompt }
        : {}),
      ...(imageInputs.length === 1
        ? { image: imageInputs[0] }
        : imageInputs.length > 1
          ? { image: imageInputs }
          : {}),
      ...(typeof videoOptions.image_tail === "string"
        ? { image_tail: videoOptions.image_tail }
        : {}),
      ...(typeof videoOptions.with_audio === "boolean"
        ? { with_audio: videoOptions.with_audio }
        : {}),
      ...(typeof videoOptions.size === "string"
        ? { size: videoOptions.size }
        : {}),
      ...(typeof videoOptions.resolution === "string"
        ? { resolution: videoOptions.resolution }
        : {}),
      ...(typeof videoOptions.aspect_ratio === "string"
        ? { aspect_ratio: videoOptions.aspect_ratio }
        : {}),
      ...(typeof videoOptions.quality === "string"
        ? { quality: videoOptions.quality }
        : {}),
      ...(typeof videoOptions.duration === "number"
        ? { duration: videoOptions.duration }
        : {}),
      ...(typeof videoOptions.fps === "number"
        ? { fps: videoOptions.fps }
        : {}),
      ...(typeof videoOptions.watermark === "boolean"
        ? { watermark: videoOptions.watermark }
        : {}),
      async: readAsyncFlag(options?.extraBody) ?? true,
      ...(isRecord(videoOptions.extra_body)
        ? { extra_body: videoOptions.extra_body }
        : videoInputs.length > 0
          ? { extra_body: { video_list: videoInputs } }
          : {}),
      ...(typeof videoOptions.retries === "number"
        ? { retries: videoOptions.retries }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${response.status} status code (${(await response.text()) || "no body"})`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeVideoTaskPayload(payload, requestConfig.model);
}

/**
 * 查询任务型对话结果。
 */
export async function retrieveChatCompletionWithUsage(
  taskId: string,
  options?: Pick<AIChatOptions, "aiConfig">
): Promise<AIChatResult> {
  const pollType = resolvePollType(options?.aiConfig);
  if (pollType === "image") {
    return await retrieveImageGenerationWithUsage(taskId, options);
  }
  if (pollType === "video") {
    return await retrieveVideoGenerationWithUsage(taskId, options);
  }

  const requestConfig = getResolvedRequestConfig(options?.aiConfig);
  const response = await fetch(
    `${requestConfig.baseUrl}/chat/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(requestConfig.apiKey
          ? { Authorization: `Bearer ${requestConfig.apiKey}` }
          : {}),
        ...(requestConfig.defaultHeaders ?? {}),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`AI 任务结果查询失败: ${response.status}`);
  }

  const payload = (await response.json()) as
    | OpenAI.Chat.Completions.ChatCompletion
    | Record<string, unknown>;

  return {
    content: getResponseText(payload),
    model: asOptionalString(payload.model) ?? requestConfig.model,
    responseId: asOptionalString(payload.id),
    status: getResponseStatus(payload),
    usage: getUsage(payload),
    output: getResponseOutput(payload),
    task: getTaskState(payload),
    raw: payload,
  };
}

/**
 * 查询图片生成任务结果。
 */
async function retrieveImageGenerationWithUsage(
  taskId: string,
  options?: Pick<AIChatOptions, "aiConfig">
): Promise<AIChatResult> {
  const requestConfig = getResolvedRequestConfig(options?.aiConfig);
  const response = await fetch(
    `${requestConfig.baseUrl}/images/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(requestConfig.apiKey
          ? { Authorization: `Bearer ${requestConfig.apiKey}` }
          : {}),
        ...(requestConfig.defaultHeaders ?? {}),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`AI 图片任务结果查询失败: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeImageTaskPayload(payload, requestConfig.model, taskId);
}

async function retrieveVideoGenerationWithUsage(
  taskId: string,
  options?: Pick<AIChatOptions, "aiConfig">
): Promise<AIChatResult> {
  const requestConfig = getResolvedRequestConfig(options?.aiConfig);
  const response = await fetch(
    `${requestConfig.baseUrl}/videos/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(requestConfig.apiKey
          ? { Authorization: `Bearer ${requestConfig.apiKey}` }
          : {}),
        ...(requestConfig.defaultHeaders ?? {}),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`AI 视频任务结果查询失败: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeVideoTaskPayload(payload, requestConfig.model, taskId);
}

export { openai, deepseek, mimo, getAIClient };

/**
 * 提取响应中的纯文本内容。
 */
function getResponseText(
  response: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>
) {
  const message = getResponseMessage(response);
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!isRecord(item)) {
          return "";
        }
        const type = item.type;
        if (type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * 提取响应中的统一输出结构。
 */
function getResponseOutput(
  response: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>
): AIOutput {
  const message = getResponseMessage(response);
  if (!message) {
    return {};
  }

  const audio = isRecord(message.audio)
    ? {
        id: asOptionalString(message.audio.id),
        data: asOptionalString(message.audio.data),
        expiresAt: asOptionalNumber(message.audio.expires_at),
        transcript: asOptionalString(message.audio.transcript),
      }
    : null;

  return {
    text: getResponseText(response) || undefined,
    image: asOptionalString(message.image),
    video: asOptionalString(message.video),
    audio,
  };
}

/**
 * 提取统一 usage 结构。
 */
function getUsage(
  response: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>
): AIUsage {
  const usage = isRecord(response.usage) ? response.usage : {};
  const promptDetails = isRecord(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : {};
  const completionDetails = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : {};

  return {
    promptTokens: asOptionalNumber(usage.prompt_tokens) ?? 0,
    completionTokens: asOptionalNumber(usage.completion_tokens) ?? 0,
    totalTokens: asOptionalNumber(usage.total_tokens) ?? 0,
    textInputTokens: asOptionalNumber(promptDetails.text_tokens) ?? undefined,
    imageInputTokens: asOptionalNumber(promptDetails.image_tokens) ?? undefined,
    audioInputTokens: asOptionalNumber(promptDetails.audio_tokens) ?? undefined,
    videoInputTokens: asOptionalNumber(promptDetails.video_tokens) ?? undefined,
    reasoningTokens:
      asOptionalNumber(completionDetails.reasoning_tokens) ?? undefined,
    cachedTokens: asOptionalNumber(promptDetails.cached_tokens) ?? undefined,
    billedUnits: asOptionalNumber(usage.billed_units) ?? undefined,
  };
}

/**
 * 提取上游响应状态。
 */
function getResponseStatus(
  response: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>
) {
  const status = isRecord(response) ? asOptionalString(response.status) : null;
  return normalizeTaskStatus(status);
}

/**
 * 从上游响应里提取任务状态。
 */
function getTaskState(
  response: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>
): AITaskState | null {
  const status = getResponseStatus(response);
  const id = asOptionalString(response.id);
  // 兼容只返回任务元信息的异步图片/视频创建响应。
  if (!status || !id || status === "completed") {
    return null;
  }
  return { id, status };
}

/**
 * 安全提取首条消息对象。
 */
function getResponseMessage(
  response: OpenAI.Chat.Completions.ChatCompletion | Record<string, unknown>
) {
  if (!Array.isArray(response.choices)) {
    return null;
  }
  const firstChoice = response.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return null;
  }
  return firstChoice.message;
}

/**
 * 判断值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 将未知值安全转换为字符串。
 */
function asOptionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

/**
 * 将未知值安全转换为数字。
 */
function asOptionalNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

/**
 * 解析对上游 HTTP 请求所需的配置。
 */
function getResolvedRequestConfig(config?: AIConfig) {
  const provider = getAIProvider(config);

  if (provider === "deepseek") {
    return {
      apiKey: config?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      baseUrl: trimTrailingSlash(
        config?.baseUrl ?? "https://api.deepseek.com/v1"
      ),
      defaultHeaders: undefined,
      model: getAIModel(config),
    };
  }

  if (provider === "mimo") {
    const baseUrl =
      config?.baseUrl ??
      (useOpenAIGateway
        ? openaiGatewayConfig.baseURL
        : "https://api.xiaomimimo.com/v1");

    return {
      apiKey: config?.apiKey ?? process.env.MIMO_API_KEY ?? "",
      baseUrl: trimTrailingSlash(baseUrl ?? ""),
      defaultHeaders:
        useOpenAIGateway && !config?.baseUrl
          ? openaiGatewayConfig.defaultHeaders
          : undefined,
      model: getAIModel(config),
    };
  }

  const baseUrl =
    config?.baseUrl ??
    openaiGatewayConfig.baseURL ??
    "https://api.openai.com/v1";
  return {
    apiKey: config?.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    baseUrl: trimTrailingSlash(baseUrl),
    defaultHeaders: config?.baseUrl
      ? undefined
      : openaiGatewayConfig.defaultHeaders,
    model: getAIModel(config),
  };
}

/**
 * 统一图片任务状态到平台内部状态。
 */
function normalizeImageGenerationTaskStatus(status: string | null) {
  return normalizeTaskStatus(status);
}

function extractImageGenerationPrompt(messages: AIProviderMessage[]) {
  return messages
    .flatMap((message) => {
      if (typeof message.content === "string") {
        return [message.content.trim()];
      }
      return message.content
        .map((part) =>
          isRecord(part) &&
          part.type === "text" &&
          typeof part.text === "string"
            ? part.text.trim()
            : ""
        )
        .filter(Boolean);
    })
    .join("\n\n")
    .trim();
}

function extractImageInputs(messages: AIProviderMessage[]) {
  const images: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      const url = readContentUrl(part, "image_url");
      if (url) {
        images.push(url);
      }
    }
  }
  return images;
}

function extractVideoInputs(messages: AIProviderMessage[]) {
  const videos: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      const url = readContentUrl(part, "video_url");
      if (url) {
        videos.push(url);
      }
    }
  }
  return videos;
}

function readContentUrl(
  part: Record<string, unknown>,
  type: "image_url" | "video_url"
) {
  if (!isRecord(part) || part.type !== type) {
    return null;
  }
  const value = isRecord(part[type]) ? part[type] : null;
  return typeof value?.url === "string" && value.url.trim()
    ? value.url.trim()
    : null;
}

function resolveEndpointType(
  config: AIConfig | undefined,
  extraBody: Record<string, unknown> | undefined
): AIEndpointType {
  if (config?.endpointType) {
    return config.endpointType;
  }
  if (
    extraBody?.image_generation === true &&
    typeof config?.model === "string" &&
    /^nano-banana(?:$|-)|^gpt-image-1(?:$|-)/.test(config.model)
  ) {
    return "images_generations";
  }
  return "chat_completions";
}

function resolvePollType(config?: AIConfig): AIPollType {
  if (config?.pollType) {
    return config.pollType;
  }
  if (typeof config?.model === "string") {
    if (/^nano-banana(?:$|-)|^gpt-image-1(?:$|-)/.test(config.model)) {
      return "image";
    }
    if (/sora|veo|kling|cogvideo|wanx|hunyuan.*video/.test(config.model)) {
      return "video";
    }
  }
  return "chat";
}

function readAsyncFlag(extraBody: Record<string, unknown> | undefined) {
  if (typeof extraBody?.async === "boolean") {
    return extraBody.async;
  }
  return extraBody?.background === true ? true : undefined;
}

function readBackgroundValue(extraBody: Record<string, unknown> | undefined) {
  return typeof extraBody?.background === "string"
    ? extraBody.background
    : null;
}

function normalizeImageTaskPayload(
  payload: Record<string, unknown>,
  fallbackModel: string,
  fallbackTaskId?: string
): AIChatResult {
  const data = Array.isArray(payload.data) ? payload.data : [];
  const images = data
    .map((item) => (isRecord(item) ? asOptionalString(item.url) : null))
    .filter((item): item is string => !!item)
    .map((url) => ({ url }));
  const firstItem = isRecord(data[0]) ? data[0] : null;
  const firstImage = images[0]?.url ?? null;
  const taskStatus = asOptionalString(payload.task_status);
  const usage = isRecord(payload.usage) ? payload.usage : {};

  return {
    content: asOptionalString(firstItem?.revised_prompt) ?? "",
    model: asOptionalString(payload.model) ?? fallbackModel,
    responseId: asOptionalString(payload.task_id) ?? fallbackTaskId ?? null,
    status: normalizeImageGenerationTaskStatus(taskStatus),
    usage: {
      promptTokens: asOptionalNumber(usage.input_tokens) ?? 0,
      completionTokens: asOptionalNumber(usage.output_tokens) ?? 0,
      totalTokens: asOptionalNumber(usage.total_tokens) ?? 0,
    },
    output: firstImage ? { image: firstImage, images } : {},
    task:
      taskStatus && taskStatus !== "succeed"
        ? {
            id: asOptionalString(payload.task_id) ?? fallbackTaskId ?? "",
            status: normalizeImageGenerationTaskStatus(taskStatus),
          }
        : null,
    raw: payload,
  };
}

function normalizeVideoTaskPayload(
  payload: Record<string, unknown>,
  fallbackModel: string,
  fallbackTaskId?: string
): AIChatResult {
  const taskStatus = asOptionalString(payload.task_status);
  const videoResult = isRecord(payload.video_result)
    ? payload.video_result
    : {};
  const videoUrl = asOptionalString(videoResult.url);
  const revisedPrompt = asOptionalString(videoResult.revised_prompt) ?? "";

  return {
    content: revisedPrompt,
    model: asOptionalString(payload.model) ?? fallbackModel,
    responseId: asOptionalString(payload.task_id) ?? fallbackTaskId ?? null,
    status: normalizeTaskStatus(taskStatus),
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    output: videoUrl
      ? { text: revisedPrompt || undefined, video: videoUrl }
      : {},
    task:
      taskStatus && taskStatus !== "succeed"
        ? {
            id: asOptionalString(payload.task_id) ?? fallbackTaskId ?? "",
            status: normalizeTaskStatus(taskStatus),
          }
        : null,
    raw: payload,
  };
}

function normalizeTaskStatus(status: string | null) {
  if (status === "succeed" || status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "pending" || status === "running" || status === "queued") {
    return "pending";
  }
  return status ?? "completed";
}

/**
 * 去掉末尾斜杠，避免路径重复。
 */
function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
