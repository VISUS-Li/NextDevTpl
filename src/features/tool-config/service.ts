import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  aiRelayModelBinding,
  aiRelayProvider,
  project,
  type ToolConfigField,
  type ToolConfigFieldType,
  type ToolConfigScope,
  toolConfigAuditLog,
  toolConfigField,
  toolConfigValue,
  toolFeature,
  toolRegistry,
  toolStorageRule,
} from "@/db/schema";
import type { ToolConfigValueInput } from "./schema";
import {
  DEFAULT_PROJECT_KEY,
  getBuiltInToolDefinition,
  listBuiltInToolDefinitions,
  listBuiltInToolFeatures,
  listBuiltInToolStorageRules,
  SLOT_CONFIG_COUNT,
  SLOT_JSON_COUNT,
  SLOT_SECRET_COUNT,
  SLOT_TEXT_COUNT,
} from "./tool-definitions";

export { DEFAULT_PROJECT_KEY } from "./tool-definitions";

const REDINK_EMPTY_MODEL_CATALOG: RedinkModelCatalog = {
  text_generation: {
    defaultModel: null,
    options: [],
  },
  image_generation: {
    defaultModel: null,
    options: [],
  },
};

export type RedinkModelCatalogOption = {
  modelKey: string;
  label: string;
  description: string | null;
};

export type RedinkModelCatalogGroup = {
  defaultModel: string | null;
  options: ReadonlyArray<RedinkModelCatalogOption>;
};

export type RedinkModelCatalog = {
  text_generation: RedinkModelCatalogGroup;
  image_generation: RedinkModelCatalogGroup;
};

type ConfigValueRow = typeof toolConfigValue.$inferSelect;

type SaveConfigParams = {
  projectKey?: string;
  toolKey: string;
  values: Record<string, ToolConfigValueInput>;
  clearSecrets?: string[];
  actorId: string;
};

type ResolvedValue = {
  value: ToolConfigValueInput | undefined;
  secretSet: boolean;
  source: "default" | "project_admin" | "user" | "empty";
};

type DefaultFieldDefinition = {
  toolKey: string;
  fieldKey: string;
  label: string;
  description?: string;
  group: string;
  type: ToolConfigFieldType;
  required?: boolean;
  adminOnly?: boolean;
  userOverridable?: boolean;
  defaultValueJson?: ToolConfigValueInput;
  optionsJson?: string[];
  validationJson?: Record<string, unknown>;
  sortOrder: number;
};

const builtInToolDefinitions = listBuiltInToolDefinitions();
const HIDDEN_ADMIN_TOOL_KEYS = new Set(["storage"]);
const defaultFieldDefinitions: DefaultFieldDefinition[] =
  builtInToolDefinitions.flatMap((tool) =>
    buildDefaultSlotFields(tool.toolKey).map((field) => {
      const override = tool.fieldOverrides?.[field.fieldKey];
      return {
        ...field,
        label: override?.label ?? field.label,
        ...((override?.description ?? field.description)
          ? { description: override?.description ?? field.description }
          : {}),
        type: override?.type ?? field.type,
        ...((override?.required ?? field.required)
          ? { required: override?.required ?? field.required }
          : {}),
        ...((override?.adminOnly ?? field.adminOnly)
          ? { adminOnly: override?.adminOnly ?? field.adminOnly }
          : {}),
        userOverridable:
          override?.userOverridable ?? field.userOverridable ?? false,
        ...((override?.defaultValueJson ?? field.defaultValueJson) !== undefined
          ? {
              defaultValueJson:
                override?.defaultValueJson ?? field.defaultValueJson,
            }
          : {}),
        ...((override?.optionsJson ?? field.optionsJson)
          ? { optionsJson: override?.optionsJson ?? field.optionsJson }
          : {}),
        ...((override?.validationJson ?? field.validationJson)
          ? { validationJson: override?.validationJson ?? field.validationJson }
          : {}),
      };
    })
  );

/**
 * 初始化默认项目和工具字段
 */
export async function seedDefaultToolConfigProject(params?: {
  projectKey?: string;
  name?: string;
}) {
  const now = new Date();
  const projectKey = params?.projectKey ?? DEFAULT_PROJECT_KEY;
  const currentProject = await ensureProject(
    projectKey,
    params?.name ?? "tripai",
    now
  );

  for (const tool of builtInToolDefinitions) {
    const [existingTool] = await db
      .select()
      .from(toolRegistry)
      .where(
        and(
          eq(toolRegistry.projectId, currentProject.id),
          eq(toolRegistry.toolKey, tool.toolKey)
        )
      )
      .limit(1);

    if (!existingTool) {
      await db
        .insert(toolRegistry)
        .values({
          id: crypto.randomUUID(),
          projectId: currentProject.id,
          toolKey: tool.toolKey,
          name: tool.name,
          description: tool.description,
          metadata: tool.metadata,
          sortOrder: tool.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      continue;
    }

    if (
      existingTool.name !== tool.name ||
      existingTool.description !== tool.description ||
      JSON.stringify(existingTool.metadata ?? null) !==
        JSON.stringify(tool.metadata) ||
      existingTool.sortOrder !== tool.sortOrder
    ) {
      await db
        .update(toolRegistry)
        .set({
          name: tool.name,
          description: tool.description,
          metadata: tool.metadata,
          sortOrder: tool.sortOrder,
          updatedAt: now,
        })
        .where(eq(toolRegistry.id, existingTool.id));
    }
  }

  for (const field of defaultFieldDefinitions) {
    const [existingField] = await db
      .select()
      .from(toolConfigField)
      .where(
        and(
          eq(toolConfigField.projectId, currentProject.id),
          eq(toolConfigField.toolKey, field.toolKey),
          eq(toolConfigField.fieldKey, field.fieldKey)
        )
      )
      .limit(1);

    if (!existingField) {
      await db
        .insert(toolConfigField)
        .values({
          id: crypto.randomUUID(),
          projectId: currentProject.id,
          toolKey: field.toolKey,
          fieldKey: field.fieldKey,
          label: field.label,
          description: field.description,
          group: field.group,
          type: field.type,
          required: field.required ?? false,
          adminOnly: field.adminOnly ?? false,
          userOverridable: field.userOverridable ?? false,
          defaultValueJson: field.defaultValueJson,
          optionsJson: field.optionsJson,
          validationJson: field.validationJson,
          sortOrder: field.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      continue;
    }

    if (
      existingField.label !== field.label ||
      existingField.description !== (field.description ?? null) ||
      existingField.group !== field.group ||
      existingField.type !== field.type ||
      existingField.required !== (field.required ?? false) ||
      existingField.adminOnly !== (field.adminOnly ?? false) ||
      existingField.userOverridable !== (field.userOverridable ?? false) ||
      existingField.sortOrder !== field.sortOrder
    ) {
      await db
        .update(toolConfigField)
        .set({
          label: field.label,
          description: field.description ?? null,
          group: field.group,
          type: field.type,
          required: field.required ?? false,
          adminOnly: field.adminOnly ?? false,
          userOverridable: field.userOverridable ?? false,
          sortOrder: field.sortOrder,
          updatedAt: now,
        })
        .where(eq(toolConfigField.id, existingField.id));
    }
  }

  for (const tool of builtInToolDefinitions) {
    const expectedFieldKeys = defaultFieldDefinitions
      .filter((field) => field.toolKey === tool.toolKey)
      .map((field) => field.fieldKey);

    if (expectedFieldKeys.length === 0) {
      continue;
    }

    await db
      .delete(toolConfigValue)
      .where(
        and(
          eq(toolConfigValue.projectId, currentProject.id),
          eq(toolConfigValue.toolKey, tool.toolKey),
          notInArray(toolConfigValue.fieldKey, expectedFieldKeys)
        )
      );
    await db
      .delete(toolConfigField)
      .where(
        and(
          eq(toolConfigField.projectId, currentProject.id),
          eq(toolConfigField.toolKey, tool.toolKey),
          notInArray(toolConfigField.fieldKey, expectedFieldKeys)
        )
      );
  }

  await seedBuiltInRuntimeConfig(currentProject.id, now);
  await seedBuiltInToolFeatures(currentProject.id, now);
  await seedBuiltInToolStorageRules(currentProject.id, now);

  return currentProject;
}

/**
 * 按工具定义补齐默认运行时配置。
 */
async function seedBuiltInRuntimeConfig(projectId: string, now: Date) {
  const [currentProject] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  for (const tool of builtInToolDefinitions) {
    const runtimeDefaults = getToolRuntimeDefaults(
      currentProject?.key ?? DEFAULT_PROJECT_KEY,
      tool.toolKey
    );
    const runtimeFields = Object.entries(runtimeDefaults) as Array<
      [string, ToolConfigValueInput]
    >;
    if (runtimeFields.length === 0) {
      continue;
    }

    const rows = await db
      .select()
      .from(toolConfigValue)
      .where(
        and(
          eq(toolConfigValue.projectId, projectId),
          eq(toolConfigValue.toolKey, tool.toolKey),
          eq(toolConfigValue.scope, "project_admin"),
          isNull(toolConfigValue.userId)
        )
      );
    const rowMap = new Map(rows.map((row) => [row.fieldKey, row]));

    for (const [fieldKey, defaultValue] of runtimeFields) {
      const currentRow = rowMap.get(fieldKey);
      if (!currentRow) {
        await db
          .insert(toolConfigValue)
          .values({
            id: crypto.randomUUID(),
            projectId,
            toolKey: tool.toolKey,
            fieldKey,
            scope: "project_admin",
            valueJson: defaultValue,
            updatedBy: "system",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        continue;
      }

      const mergedValue = mergeRuntimeDefaultValue(
        fieldKey,
        defaultValue,
        currentRow.valueJson
      );

      if (mergedValue === undefined) {
        continue;
      }

      await db
        .update(toolConfigValue)
        .set({
          valueJson: mergedValue,
          revision: currentRow.revision + 1,
          updatedBy: "system",
          updatedAt: now,
        })
        .where(eq(toolConfigValue.id, currentRow.id));
    }
  }
}

/**
 * 按工具定义补齐功能清单。
 */
async function seedBuiltInToolFeatures(projectId: string, now: Date) {
  for (const tool of builtInToolDefinitions) {
    const features = listBuiltInToolFeatures(tool.toolKey);
    if (features.length === 0) {
      continue;
    }

    for (const [index, feature] of features.entries()) {
      const [existingFeature] = await db
        .select({ id: toolFeature.id })
        .from(toolFeature)
        .where(
          and(
            eq(toolFeature.projectId, projectId),
            eq(toolFeature.toolKey, tool.toolKey),
            eq(toolFeature.featureKey, feature.featureKey)
          )
        )
        .limit(1);

      const featureValues = {
        projectId,
        toolKey: tool.toolKey,
        featureKey: feature.featureKey,
        name: feature.name,
        description: feature.description ?? null,
        requestType: feature.requestType,
        defaultOperation: feature.defaultOperation ?? null,
        requiredCapabilities: feature.requiredCapabilities ?? null,
        enabled: feature.enabled ?? true,
        sortOrder: feature.sortOrder ?? (index + 1) * 10,
        updatedAt: now,
      };

      if (existingFeature) {
        await db
          .update(toolFeature)
          .set(featureValues)
          .where(eq(toolFeature.id, existingFeature.id));
        continue;
      }

      await db.insert(toolFeature).values({
        id: crypto.randomUUID(),
        ...featureValues,
        createdAt: now,
      });
    }
  }
}

/**
 * 按工具定义补齐存储规则。
 */
async function seedBuiltInToolStorageRules(projectId: string, now: Date) {
  for (const tool of builtInToolDefinitions) {
    const rules = listBuiltInToolStorageRules(tool.toolKey);
    const expectedPurposes = rules.map((item) => item.purpose);

    if (expectedPurposes.length > 0) {
      await db
        .delete(toolStorageRule)
        .where(
          and(
            eq(toolStorageRule.projectId, projectId),
            eq(toolStorageRule.toolKey, tool.toolKey),
            notInArray(toolStorageRule.purpose, expectedPurposes)
          )
        );
    } else {
      await db
        .delete(toolStorageRule)
        .where(
          and(
            eq(toolStorageRule.projectId, projectId),
            eq(toolStorageRule.toolKey, tool.toolKey)
          )
        );
      continue;
    }

    for (const rule of rules) {
      const [existingRule] = await db
        .select({ id: toolStorageRule.id })
        .from(toolStorageRule)
        .where(
          and(
            eq(toolStorageRule.projectId, projectId),
            eq(toolStorageRule.toolKey, tool.toolKey),
            eq(toolStorageRule.purpose, rule.purpose)
          )
        )
        .limit(1);

      const ruleValues = {
        projectId,
        toolKey: tool.toolKey,
        purpose: rule.purpose,
        prefix: rule.prefix,
        retentionClass: rule.retentionClass,
        ttlHours: rule.ttlHours ?? null,
        maxSizeBytes: rule.maxSizeBytes ?? null,
        contentTypes: rule.contentTypes ?? null,
        enabled: rule.enabled,
        updatedAt: now,
      };

      if (existingRule) {
        await db
          .update(toolStorageRule)
          .set(ruleValues)
          .where(eq(toolStorageRule.id, existingRule.id));
        continue;
      }

      await db.insert(toolStorageRule).values({
        id: crypto.randomUUID(),
        ...ruleValues,
        createdAt: now,
      });
    }
  }
}

function mergeStoragePrefixRules(
  defaults: readonly Record<string, unknown>[],
  currentValue: unknown[]
) {
  const currentByPrefix = new Map(
    currentValue
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
      .map((item) => [String(item.prefix ?? ""), item])
  );

  return defaults.map((item) => {
    const prefix = String(item.prefix ?? "");
    return {
      ...item,
      ...(currentByPrefix.get(prefix) ?? {}),
    };
  });
}

function mergeRuntimeDefaultValue(
  fieldKey: string,
  defaultValue: ToolConfigValueInput,
  currentValue: unknown
) {
  if (
    fieldKey === "json1" &&
    Array.isArray(defaultValue) &&
    Array.isArray(currentValue)
  ) {
    const mergedValue = mergeStoragePrefixRules(
      defaultValue.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      ),
      currentValue
    );
    return JSON.stringify(mergedValue) === JSON.stringify(currentValue)
      ? undefined
      : mergedValue;
  }

  if (
    fieldKey === "json2" &&
    typeof defaultValue === "object" &&
    defaultValue &&
    !Array.isArray(defaultValue) &&
    typeof currentValue === "object" &&
    currentValue &&
    !Array.isArray(currentValue)
  ) {
    const mergedValue = {
      ...(defaultValue as Record<string, unknown>),
      ...(currentValue as Record<string, unknown>),
    };
    return JSON.stringify(mergedValue) === JSON.stringify(currentValue)
      ? undefined
      : mergedValue;
  }

  return undefined;
}

function buildDefaultSlotFields(toolKey: string): DefaultFieldDefinition[] {
  return [
    ...buildFieldSeries(toolKey, "config", "string", SLOT_CONFIG_COUNT, 10),
    ...buildFieldSeries(toolKey, "secret", "secret", SLOT_SECRET_COUNT, 200),
    ...buildFieldSeries(toolKey, "json", "json", SLOT_JSON_COUNT, 400),
    ...buildFieldSeries(toolKey, "text", "textarea", SLOT_TEXT_COUNT, 500),
  ];
}

function buildFieldSeries(
  toolKey: string,
  prefix: "config" | "secret" | "json" | "text",
  type: ToolConfigFieldType,
  count: number,
  startSortOrder: number
): DefaultFieldDefinition[] {
  return Array.from({ length: count }, (_, index) => {
    const fieldNumber = index + 1;
    const fieldKey = `${prefix}${fieldNumber}`;

    return {
      toolKey,
      fieldKey,
      label: fieldKey,
      description: `${toolKey} 的 ${fieldKey} 通用槽位`,
      group: prefix,
      type,
      userOverridable: true,
      sortOrder: startSortOrder + fieldNumber,
    };
  });
}

/**
 * 保存管理员工具配置
 */
export async function saveAdminToolConfig(params: SaveConfigParams) {
  return await saveToolConfigValues({
    ...params,
    scope: "project_admin",
  });
}

/**
 * 保存用户工具配置
 */
export async function saveUserToolConfig(params: SaveConfigParams) {
  return await saveToolConfigValues({
    ...params,
    scope: "user",
  });
}

/**
 * 读取工具配置编辑数据
 */
export async function getToolConfigEditorData(params: {
  projectKey?: string;
  toolKey: string;
  userId?: string;
  mode: "admin" | "user";
}) {
  const { currentProject, fields } = await getProjectFields(
    params.projectKey ?? DEFAULT_PROJECT_KEY,
    params.toolKey
  );
  const visibleFields =
    params.mode === "admin"
      ? fields
      : fields.filter((field) => !field.adminOnly && field.userOverridable);
  const valuesParams: {
    projectId: string;
    toolKey: string;
    userId?: string;
  } = {
    projectId: currentProject.id,
    toolKey: params.toolKey,
  };
  if (params.userId) {
    valuesParams.userId = params.userId;
  }
  const values = await getConfigValues(valuesParams);

  return {
    projectKey: currentProject.key,
    tool: params.toolKey,
    revision: currentProject.configRevision,
    fields: visibleFields.map((field) => {
      const resolved = resolveFieldValue(field, values);
      const settingLabel = getToolFieldSettingLabel(
        params.toolKey,
        field.fieldKey,
        field.label
      );
      return {
        fieldKey: field.fieldKey,
        label: field.label,
        settingLabel,
        description: field.description,
        group: field.group,
        type: field.type,
        ...(field.type === "secret" ? {} : { value: resolved.value }),
        ...(field.type === "secret" ? { secretSet: resolved.secretSet } : {}),
        source: resolved.source,
        options: field.optionsJson,
        required: field.required,
        editable: params.mode === "admin" || field.userOverridable,
      };
    }),
  };
}

function getToolFieldSettingLabel(
  toolKey: string,
  fieldKey: string,
  fallback: string
) {
  return (
    getBuiltInToolDefinition(toolKey)?.slotSettingLabels?.[fieldKey] ?? fallback
  );
}

/**
 * 读取管理员工具配置页面数据
 */
export async function getAdminToolConfigPageData(
  projectKey = DEFAULT_PROJECT_KEY
) {
  const currentProject = await seedDefaultToolConfigProject({ projectKey });
  const tools = await db
    .select()
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        notInArray(toolRegistry.toolKey, [...HIDDEN_ADMIN_TOOL_KEYS])
      )
    )
    .orderBy(asc(toolRegistry.sortOrder), asc(toolRegistry.toolKey));
  const toolConfigs = await Promise.all(
    tools.map(async (tool) => ({
      tool,
      editor: await getToolConfigEditorData({
        projectKey,
        toolKey: tool.toolKey,
        mode: "admin",
      }),
    }))
  );

  return {
    project: currentProject,
    toolConfigs,
  };
}

/**
 * 读取用户工具配置页面数据
 */
export async function getUserToolConfigPageData(params: {
  userId: string;
  projectKey?: string;
}) {
  const projectKey = params.projectKey ?? DEFAULT_PROJECT_KEY;
  const currentProject = await seedDefaultToolConfigProject({ projectKey });
  const tools = await db
    .select()
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        eq(toolRegistry.enabled, true)
      )
    )
    .orderBy(asc(toolRegistry.sortOrder), asc(toolRegistry.toolKey));
  const toolConfigs = (
    await Promise.all(
      tools.map(async (tool) => ({
        tool,
        editor: await getToolConfigEditorData({
          projectKey,
          toolKey: tool.toolKey,
          userId: params.userId,
          mode: "user",
        }),
      }))
    )
  ).filter((item) => item.editor.fields.length > 0);

  return {
    project: currentProject,
    toolConfigs,
  };
}

/**
 * 读取工具配置版本
 */
export async function getToolConfigRevision(projectKey = DEFAULT_PROJECT_KEY) {
  const [currentProject] = await db
    .select({ configRevision: project.configRevision })
    .from(project)
    .where(eq(project.key, projectKey))
    .limit(1);

  if (!currentProject) {
    throw new Error("项目配置不存在");
  }

  return currentProject.configRevision;
}

/**
 * 解析工具最终运行配置
 */
export async function getResolvedToolConfig(params: {
  projectKey?: string;
  toolKey: string;
  userId?: string;
}) {
  // 先补齐项目和默认字段，避免显式 projectKey 首次访问时直接报项目不存在。
  const projectKey = params.projectKey ?? DEFAULT_PROJECT_KEY;
  await seedDefaultToolConfigProject({ projectKey });
  const { currentProject, fields } = await getProjectFields(
    projectKey,
    params.toolKey
  );
  const valuesParams: {
    projectId: string;
    toolKey: string;
    userId?: string;
  } = {
    projectId: currentProject.id,
    toolKey: params.toolKey,
  };
  if (params.userId) {
    valuesParams.userId = params.userId;
  }
  const values = await getConfigValues(valuesParams);
  const config: Record<string, unknown> = {};

  for (const field of fields) {
    const resolved = resolveFieldValue(field, values, true);
    if (resolved.value !== undefined) {
      setNestedConfigValue(config, field.fieldKey, resolved.value);
    }
  }

  validateRequiredFields(fields, config);

  return {
    projectKey: currentProject.key,
    tool: params.toolKey,
    revision: currentProject.configRevision,
    config,
  };
}

/**
 * 解析工具 AI 运行配置
 */
export async function getResolvedAIConfig(params: {
  projectKey?: string;
  toolKey: string;
  userId?: string;
}) {
  const resolved = await getResolvedToolConfig(params);

  return {
    projectKey: resolved.projectKey,
    tool: resolved.tool,
    revision: resolved.revision,
    ai: (resolved.config.ai ?? {}) as Record<string, unknown>,
  };
}

/**
 * 读取 RedInk 用户可见模型目录。
 */
export async function getRedinkResolvedModelCatalog(params: {
  projectKey?: string;
  userId: string;
}) {
  const projectKey = params.projectKey ?? DEFAULT_PROJECT_KEY;
  const resolved = await getResolvedToolConfig({
    toolKey: "redink",
    userId: params.userId,
    ...(params.projectKey ? { projectKey: params.projectKey } : {}),
  });
  const config = resolved.config as Record<string, unknown>;

  return {
    projectKey: resolved.projectKey,
    revision: resolved.revision,
    catalog: normalizeRedinkModelCatalog(
      config.json4,
      getRedinkDefaultModelCatalog(projectKey)
    ),
  };
}

/**
 * 读取启用中的 AI 模型绑定能力快照。
 */
export async function listEnabledAIModelBindingCapabilities() {
  const rows = await db
    .select({
      modelKey: aiRelayModelBinding.modelKey,
      metadata: aiRelayModelBinding.metadata,
    })
    .from(aiRelayModelBinding)
    .innerJoin(
      aiRelayProvider,
      eq(aiRelayModelBinding.providerId, aiRelayProvider.id)
    )
    .where(
      and(
        eq(aiRelayModelBinding.enabled, true),
        eq(aiRelayProvider.enabled, true),
        eq(aiRelayProvider.requestType, "chat")
      )
    );

  return rows.map((row) => ({
    modelKey: row.modelKey,
    capabilities: normalizeBindingCapabilities(row.metadata),
  }));
}

async function saveToolConfigValues(
  params: SaveConfigParams & { scope: ToolConfigScope }
) {
  const projectKey = params.projectKey ?? DEFAULT_PROJECT_KEY;
  const { currentProject, fields } = await getProjectFields(
    projectKey,
    params.toolKey
  );
  const fieldMap = new Map(fields.map((field) => [field.fieldKey, field]));
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const [fieldKey, value] of Object.entries(params.values)) {
      const field = fieldMap.get(fieldKey);
      assertWritableField(field, params.scope);
      if (field.type === "secret" && value === "") {
        continue;
      }
      assertFieldValue(field, value);

      const [existing] = await tx
        .select()
        .from(toolConfigValue)
        .where(
          and(
            eq(toolConfigValue.projectId, currentProject.id),
            eq(toolConfigValue.toolKey, params.toolKey),
            eq(toolConfigValue.fieldKey, fieldKey),
            eq(toolConfigValue.scope, params.scope),
            params.scope === "user"
              ? eq(toolConfigValue.userId, params.actorId)
              : isNull(toolConfigValue.userId)
          )
        )
        .limit(1);
      const secretValue = field.type === "secret" && typeof value === "string";
      const valueUpdate = {
        valueJson: secretValue ? null : value,
        encryptedValue: secretValue ? encryptToolConfigSecret(value) : null,
        secretSet: secretValue,
        updatedBy: params.actorId,
        updatedAt: now,
      };

      if (existing) {
        await tx
          .update(toolConfigValue)
          .set({
            ...valueUpdate,
            revision: existing.revision + 1,
          })
          .where(eq(toolConfigValue.id, existing.id));
      } else {
        await tx.insert(toolConfigValue).values({
          id: crypto.randomUUID(),
          projectId: currentProject.id,
          toolKey: params.toolKey,
          fieldKey,
          scope: params.scope,
          userId: params.scope === "user" ? params.actorId : null,
          ...valueUpdate,
          createdAt: now,
        });
      }

      await tx.insert(toolConfigAuditLog).values({
        id: crypto.randomUUID(),
        projectId: currentProject.id,
        toolKey: params.toolKey,
        fieldKey,
        scope: params.scope,
        userId: params.scope === "user" ? params.actorId : null,
        actorId: params.actorId,
        action: existing ? "update" : "create",
        createdAt: now,
      });
    }

    for (const fieldKey of params.clearSecrets ?? []) {
      const field = fieldMap.get(fieldKey);
      assertWritableField(field, params.scope);
      if (field.type !== "secret") {
        throw new Error("只能清空密钥字段");
      }
      await tx
        .delete(toolConfigValue)
        .where(
          and(
            eq(toolConfigValue.projectId, currentProject.id),
            eq(toolConfigValue.toolKey, params.toolKey),
            eq(toolConfigValue.fieldKey, fieldKey),
            eq(toolConfigValue.scope, params.scope),
            params.scope === "user"
              ? eq(toolConfigValue.userId, params.actorId)
              : isNull(toolConfigValue.userId)
          )
        );
      await tx.insert(toolConfigAuditLog).values({
        id: crypto.randomUUID(),
        projectId: currentProject.id,
        toolKey: params.toolKey,
        fieldKey,
        scope: params.scope,
        userId: params.scope === "user" ? params.actorId : null,
        actorId: params.actorId,
        action: "clear",
        createdAt: now,
      });
    }

    await tx
      .update(project)
      .set({
        configRevision: sql`${project.configRevision} + 1`,
        updatedAt: now,
      })
      .where(eq(project.id, currentProject.id));
  });

  return await getToolConfigRevision(projectKey);
}

async function ensureProject(projectKey: string, name: string, now: Date) {
  const [existingProject] = await db
    .select()
    .from(project)
    .where(eq(project.key, projectKey))
    .limit(1);

  if (existingProject) {
    return existingProject;
  }

  const [newProject] = await db
    .insert(project)
    .values({
      id: crypto.randomUUID(),
      key: projectKey,
      name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!newProject) {
    throw new Error("创建项目配置失败");
  }

  return newProject;
}

async function getProjectFields(projectKey: string, toolKey: string) {
  const [currentProject] = await db
    .select()
    .from(project)
    .where(eq(project.key, projectKey))
    .limit(1);

  if (!currentProject) {
    throw new Error("项目配置不存在");
  }

  const [tool] = await db
    .select()
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        eq(toolRegistry.toolKey, toolKey),
        eq(toolRegistry.enabled, true)
      )
    )
    .limit(1);

  if (!tool) {
    throw new Error("工具配置不存在或未启用");
  }

  const fields = await db
    .select()
    .from(toolConfigField)
    .where(
      and(
        eq(toolConfigField.projectId, currentProject.id),
        eq(toolConfigField.toolKey, toolKey),
        eq(toolConfigField.enabled, true)
      )
    )
    .orderBy(asc(toolConfigField.sortOrder), asc(toolConfigField.fieldKey));

  return { currentProject, fields };
}

async function getConfigValues(params: {
  projectId: string;
  toolKey: string;
  userId?: string;
}) {
  const rows = await db
    .select()
    .from(toolConfigValue)
    .where(
      and(
        eq(toolConfigValue.projectId, params.projectId),
        eq(toolConfigValue.toolKey, params.toolKey)
      )
    );

  return rows.filter(
    (row) => row.scope === "project_admin" || row.userId === params.userId
  );
}

function resolveFieldValue(
  field: ToolConfigField,
  values: ConfigValueRow[],
  decryptSecret = false
): ResolvedValue {
  const userValue = values.find(
    (value) => value.scope === "user" && value.fieldKey === field.fieldKey
  );
  const adminValue = values.find(
    (value) =>
      value.scope === "project_admin" && value.fieldKey === field.fieldKey
  );
  const row = userValue ?? adminValue;

  if (row) {
    return {
      value:
        field.type === "secret"
          ? decryptSecret && row.encryptedValue
            ? decryptToolConfigSecret(row.encryptedValue)
            : undefined
          : (row.valueJson as ToolConfigValueInput),
      secretSet: row.secretSet,
      source: userValue ? "user" : "project_admin",
    };
  }

  return {
    value: field.defaultValueJson as ToolConfigValueInput | undefined,
    secretSet: false,
    source: field.defaultValueJson === undefined ? "empty" : "default",
  };
}

function assertWritableField(
  field: ToolConfigField | undefined,
  scope: ToolConfigScope
): asserts field is ToolConfigField {
  if (!field) {
    throw new Error("配置字段不存在");
  }
  if (scope === "user" && (field.adminOnly || !field.userOverridable)) {
    throw new Error("当前用户不能修改该配置字段");
  }
}

function assertFieldValue(field: ToolConfigField, value: ToolConfigValueInput) {
  if (field.required && (value === null || value === "")) {
    throw new Error("必填配置不能为空");
  }
  if (field.type === "secret" && typeof value !== "string") {
    throw new Error("密钥配置必须是字符串");
  }
  if (field.type === "string" && typeof value !== "string" && value !== null) {
    throw new Error("文本配置必须是字符串");
  }
  if (
    field.type === "textarea" &&
    typeof value !== "string" &&
    value !== null
  ) {
    throw new Error("长文本配置必须是字符串");
  }
  if (field.type === "number" && typeof value !== "number" && value !== null) {
    throw new Error("数字配置必须是数字");
  }
  if (field.type === "number" && typeof value === "number") {
    const minValue =
      typeof field.validationJson?.min === "number"
        ? field.validationJson.min
        : null;
    const maxValue =
      typeof field.validationJson?.max === "number"
        ? field.validationJson.max
        : null;
    if (minValue !== null && value < minValue) {
      throw new Error("数字配置低于允许范围");
    }
    if (maxValue !== null && value > maxValue) {
      throw new Error("数字配置高于允许范围");
    }
  }
  if (
    field.type === "boolean" &&
    typeof value !== "boolean" &&
    value !== null
  ) {
    throw new Error("开关配置必须是布尔值");
  }
  if (field.type === "select") {
    const options = Array.isArray(field.optionsJson) ? field.optionsJson : [];
    if (typeof value !== "string" || !options.includes(value)) {
      throw new Error("选项配置不在允许范围内");
    }
  }
  if (
    field.validationJson?.url === true &&
    typeof value === "string" &&
    value.length > 0
  ) {
    new URL(value);
  }
}

function validateRequiredFields(
  fields: ToolConfigField[],
  config: Record<string, unknown>
) {
  for (const field of fields.filter((item) => item.required)) {
    if (getNestedConfigValue(config, field.fieldKey) === undefined) {
      throw new Error(`${field.toolKey} 缺少必填配置 ${field.label}`);
    }
  }
}

function normalizeRedinkModelCatalog(
  value: unknown,
  fallbackCatalog: RedinkModelCatalog
) {
  const record = asRecord(value);
  return {
    text_generation: normalizeRedinkModelCatalogGroup(
      record?.text_generation,
      fallbackCatalog.text_generation
    ),
    image_generation: normalizeRedinkModelCatalogGroup(
      record?.image_generation,
      fallbackCatalog.image_generation
    ),
  };
}

function getRedinkRuntimeDefaults(projectKey: string) {
  const runtimeDefaults =
    getBuiltInToolDefinition("redink")?.runtimeDefaults ?? {};
  if (projectKey === DEFAULT_PROJECT_KEY) {
    return runtimeDefaults;
  }

  return {
    json2: runtimeDefaults.json2,
  } as const;
}

function getRedinkDefaultModelCatalog(projectKey: string): RedinkModelCatalog {
  return projectKey === DEFAULT_PROJECT_KEY
    ? ((getBuiltInToolDefinition("redink")?.runtimeDefaults?.json4 ??
        REDINK_EMPTY_MODEL_CATALOG) as RedinkModelCatalog)
    : REDINK_EMPTY_MODEL_CATALOG;
}

function getToolRuntimeDefaults(projectKey: string, toolKey: string) {
  if (toolKey === "redink") {
    return getRedinkRuntimeDefaults(projectKey);
  }

  return getBuiltInToolDefinition(toolKey)?.runtimeDefaults ?? {};
}

function normalizeRedinkModelCatalogGroup(
  value: unknown,
  fallback: RedinkModelCatalogGroup
): RedinkModelCatalogGroup {
  const record = asRecord(value);
  const options = Array.isArray(record?.options)
    ? record.options
        .map((item) => normalizeRedinkModelCatalogOption(item))
        .filter((item): item is RedinkModelCatalogOption => item !== null)
    : fallback.options;

  return {
    defaultModel:
      typeof record?.defaultModel === "string" && record.defaultModel.trim()
        ? record.defaultModel.trim()
        : fallback.defaultModel,
    options,
  };
}

function normalizeRedinkModelCatalogOption(
  value: unknown
): RedinkModelCatalogOption | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const modelKey =
    typeof record.modelKey === "string" ? record.modelKey.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!modelKey || !label) {
    return null;
  }
  return {
    modelKey,
    label,
    description:
      typeof record.description === "string" ? record.description.trim() : null,
  };
}

function normalizeBindingCapabilities(value: unknown) {
  const metadata = asRecord(value);
  if (!Array.isArray(metadata?.capabilities)) {
    return ["text"];
  }
  return metadata.capabilities.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}

function setNestedConfigValue(
  config: Record<string, unknown>,
  fieldKey: string,
  value: ToolConfigValueInput
) {
  const parts = fieldKey.split(".");
  let target = config;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      target[part] = {};
    }
    target = target[part] as Record<string, unknown>;
  }
  const lastPart = parts.at(-1);
  if (!lastPart) {
    throw new Error("配置字段不能为空");
  }
  target[lastPart] = value;
}

function getNestedConfigValue(
  config: Record<string, unknown>,
  fieldKey: string
) {
  let target: unknown = config;
  for (const part of fieldKey.split(".")) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return undefined;
    }
    target = (target as Record<string, unknown>)[part];
  }
  return target;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function encryptToolConfigSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getToolConfigSecretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptToolConfigSecret(value: string) {
  const [iv, tag, encrypted] = value.split(":");
  if (!iv || !tag || !encrypted) {
    throw new Error("密钥配置密文格式错误");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getToolConfigSecretKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function getToolConfigSecretKey() {
  const secret =
    process.env.CONFIG_SECRET_KEY ??
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV === "test" ? "nextdevtpl-test-config-secret" : "");
  if (!secret) {
    throw new Error("CONFIG_SECRET_KEY 或 BETTER_AUTH_SECRET 环境变量未设置");
  }
  return createHash("sha256").update(secret).digest();
}
