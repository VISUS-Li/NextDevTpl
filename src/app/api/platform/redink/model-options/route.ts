import { NextResponse } from "next/server";

import { toolConfigProjectKeySchema } from "@/features/tool-config/schema";
import {
  getRedinkResolvedModelCatalog,
  listEnabledAIModelBindingCapabilities,
  type RedinkModelCatalog,
} from "@/features/tool-config/service";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const MODEL_GROUP_REQUIRED_CAPABILITIES: Record<
  keyof RedinkModelCatalog,
  string[]
> = {
  text_generation: ["text"],
  image_generation: ["image_generation"],
};

/**
 * 返回 RedInk 用户可见模型目录。
 */
export const GET = withApiLogging(async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "unauthorized", message: "未登录" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const projectKey = toolConfigProjectKeySchema.safeParse(
    url.searchParams.get("projectKey") ?? "nextdevtpl"
  );

  if (!projectKey.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
        details: projectKey.error.flatten(),
      },
      { status: 400 }
    );
  }

  const [{ revision, catalog, allowedModels }, bindings] = await Promise.all([
    getRedinkResolvedModelCatalog({
      projectKey: projectKey.data,
      userId: session.user.id,
    }),
    listEnabledAIModelBindingCapabilities(),
  ]);
  const bindingMap = buildBindingCapabilityMap(bindings);
  const filteredCatalog = {
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

  return NextResponse.json({
    success: true,
    revision,
    ...filteredCatalog,
  });
});

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
 * 按管理员白名单和模型能力过滤用户可见目录。
 */
function filterCatalogGroup(
  group: RedinkModelCatalog[keyof RedinkModelCatalog],
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
