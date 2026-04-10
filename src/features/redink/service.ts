import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { aiRequestLog } from "@/db/schema";
import { getAIChatResult } from "@/features/ai-gateway";
import {
  getRedinkResolvedModelCatalog,
  listEnabledAIModelBindingCapabilities,
  type RedinkModelCatalog,
} from "@/features/tool-config/service";

export type RedinkModelGroupKey = keyof RedinkModelCatalog;

const MODEL_GROUP_REQUIRED_CAPABILITIES: Record<RedinkModelGroupKey, string[]> =
  {
    text_generation: ["text"],
    image_generation: ["image_generation"],
  };

/**
 * 返回经过能力过滤后的 RedInk 用户可见模型目录。
 */
export async function getRedinkUserModelCatalog(params: {
  projectKey?: string;
  userId: string;
}) {
  const [{ revision, catalog, allowedModels }, bindings] = await Promise.all([
    getRedinkResolvedModelCatalog(params),
    listEnabledAIModelBindingCapabilities(),
  ]);
  const bindingMap = buildBindingCapabilityMap(bindings);

  return {
    revision,
    text_generation: filterCatalogGroup(
      catalog.text_generation,
      allowedModels,
      bindingMap,
      MODEL_GROUP_REQUIRED_CAPABILITIES.text_generation
    ),
    image_generation: filterCatalogGroup(
      catalog.image_generation,
      allowedModels,
      bindingMap,
      MODEL_GROUP_REQUIRED_CAPABILITIES.image_generation
    ),
  };
}

/**
 * 解析 RedInk 当前场景允许使用的模型。
 */
export async function resolveRedinkUserModel(params: {
  projectKey?: string;
  userId: string;
  group: RedinkModelGroupKey;
  requestedModel?: string;
}) {
  const catalog = await getRedinkUserModelCatalog(
    params.projectKey
      ? {
          projectKey: params.projectKey,
          userId: params.userId,
        }
      : {
          userId: params.userId,
        }
  );
  const group = catalog[params.group];
  const selectedModel =
    typeof params.requestedModel === "string" && params.requestedModel.trim()
      ? params.requestedModel.trim()
      : group.defaultModel;

  if (!selectedModel) {
    return {
      revision: catalog.revision,
      selectedModel: null,
      options: group.options,
    };
  }

  const matched = group.options.find((item) => item.modelKey === selectedModel);
  return {
    revision: catalog.revision,
    selectedModel: matched?.modelKey ?? null,
    options: group.options,
  };
}

/**
 * 读取 RedInk 自己的任务结果，避免跨工具误读。
 */
export async function getRedinkAIChatResult(params: {
  requestId: string;
  userId: string;
}) {
  const [requestLog] = await db
    .select({
      requestId: aiRequestLog.requestId,
    })
    .from(aiRequestLog)
    .where(
      and(
        eq(aiRequestLog.requestId, params.requestId),
        eq(aiRequestLog.userId, params.userId),
        eq(aiRequestLog.toolKey, "redink")
      )
    )
    .limit(1);

  if (!requestLog) {
    return null;
  }

  return getAIChatResult(params);
}

/**
 * 构造模型能力索引，便于按模型过滤。
 */
function buildBindingCapabilityMap(
  bindings: Awaited<ReturnType<typeof listEnabledAIModelBindingCapabilities>>
) {
  const capabilityMap = new Map<string, Set<string>>();

  for (const binding of bindings) {
    const current = capabilityMap.get(binding.modelKey) ?? new Set<string>();
    for (const capability of binding.capabilities) {
      current.add(capability);
    }
    capabilityMap.set(binding.modelKey, current);
  }

  return capabilityMap;
}

/**
 * 按管理员白名单和模型能力过滤目录项。
 */
function filterCatalogGroup(
  group: RedinkModelCatalog[RedinkModelGroupKey],
  allowedModels: string[],
  bindingMap: Map<string, Set<string>>,
  requiredCapabilities: string[]
) {
  const options = group.options.filter((option) => {
    if (allowedModels.length > 0 && !allowedModels.includes(option.modelKey)) {
      return false;
    }
    const capabilities = bindingMap.get(option.modelKey);
    if (!capabilities) {
      return false;
    }
    return requiredCapabilities.every((capability) =>
      capabilities.has(capability)
    );
  });

  const defaultModel = options.some(
    (option) => option.modelKey === group.defaultModel
  )
    ? group.defaultModel
    : (options[0]?.modelKey ?? null);

  return {
    defaultModel,
    options,
  };
}
