import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  aiPricingRule,
  aiRequestLog,
  project,
  toolConfigField,
  toolConfigValue,
  toolDefinitionImportLog,
  toolFeature,
  toolRegistry,
  toolRuntimeToken,
  toolStorageRule,
} from "@/db/schema";
import {
  type ImportedToolDefinition,
  importToolDefinitionSchema,
} from "@/features/tool-config/schema";
import { DEFAULT_PROJECT_KEY, seedDefaultToolConfigProject } from "./service";

type ToolDefinitionSnapshot = {
  tool: typeof toolRegistry.$inferSelect | null;
  fields: Array<typeof toolConfigField.$inferSelect>;
  features: Array<typeof toolFeature.$inferSelect>;
  storageRules: Array<typeof toolStorageRule.$inferSelect>;
  pricingRules: Array<typeof aiPricingRule.$inferSelect>;
};

/**
 * 导入或更新工具定义。
 */
export async function importToolDefinition(params: {
  projectKey?: string;
  actorId: string;
  definition: ImportedToolDefinition;
}) {
  const parsed = importToolDefinitionSchema.parse({
    projectKey: params.projectKey ?? DEFAULT_PROJECT_KEY,
    definition: params.definition,
  });
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: parsed.projectKey,
  });
  const previousSnapshot = await snapshotToolDefinition(
    currentProject.id,
    parsed.definition.toolKey
  );

  await applyToolDefinition(currentProject.id, parsed.definition);
  await bumpProjectRevision(currentProject.id);
  const nextSnapshot = await snapshotToolDefinition(
    currentProject.id,
    parsed.definition.toolKey
  );

  await db.insert(toolDefinitionImportLog).values({
    id: crypto.randomUUID(),
    projectId: currentProject.id,
    toolKey: parsed.definition.toolKey,
    action: "import",
    actorId: params.actorId,
    previousDefinitionJson: serializeSnapshot(previousSnapshot),
    nextDefinitionJson: serializeSnapshot(nextSnapshot),
    summaryJson: {
      fieldCount: parsed.definition.fields.length,
      featureCount: parsed.definition.features.length,
      storageRuleCount: parsed.definition.storage.prefixRules.length,
    },
  });

  return nextSnapshot;
}

/**
 * 停用工具。
 */
export async function disableToolDefinition(params: {
  projectKey?: string;
  toolKey: string;
  actorId: string;
}) {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: params.projectKey ?? DEFAULT_PROJECT_KEY,
  });
  const previousSnapshot = await snapshotToolDefinition(
    currentProject.id,
    params.toolKey
  );

  await db
    .update(toolRegistry)
    .set({
      enabled: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        eq(toolRegistry.toolKey, params.toolKey)
      )
    );
  await bumpProjectRevision(currentProject.id);

  const nextSnapshot = await snapshotToolDefinition(
    currentProject.id,
    params.toolKey
  );
  await db.insert(toolDefinitionImportLog).values({
    id: crypto.randomUUID(),
    projectId: currentProject.id,
    toolKey: params.toolKey,
    action: "disable",
    actorId: params.actorId,
    previousDefinitionJson: serializeSnapshot(previousSnapshot),
    nextDefinitionJson: serializeSnapshot(nextSnapshot),
    summaryJson: {
      enabled: false,
    },
  });
}

/**
 * 回滚工具定义到上一次变更前的快照。
 */
export async function rollbackToolDefinition(params: {
  projectKey?: string;
  toolKey: string;
  actorId: string;
}) {
  const currentProject = await seedDefaultToolConfigProject({
    projectKey: params.projectKey ?? DEFAULT_PROJECT_KEY,
  });
  const [latestLog] = await db
    .select()
    .from(toolDefinitionImportLog)
    .where(
      and(
        eq(toolDefinitionImportLog.projectId, currentProject.id),
        eq(toolDefinitionImportLog.toolKey, params.toolKey)
      )
    )
    .orderBy(desc(toolDefinitionImportLog.createdAt))
    .limit(1);

  if (!latestLog?.previousDefinitionJson) {
    throw new Error("没有可回滚的工具定义");
  }

  const previousSnapshot =
    latestLog.previousDefinitionJson as ToolDefinitionSnapshot;
  const currentSnapshot = await snapshotToolDefinition(
    currentProject.id,
    params.toolKey
  );
  await applySnapshot(currentProject.id, params.toolKey, previousSnapshot);
  await bumpProjectRevision(currentProject.id);
  const nextSnapshot = await snapshotToolDefinition(
    currentProject.id,
    params.toolKey
  );

  await db.insert(toolDefinitionImportLog).values({
    id: crypto.randomUUID(),
    projectId: currentProject.id,
    toolKey: params.toolKey,
    action: "rollback",
    actorId: params.actorId,
    previousDefinitionJson: serializeSnapshot(currentSnapshot),
    nextDefinitionJson: serializeSnapshot(nextSnapshot),
    summaryJson: {
      restoredFrom: latestLog.id,
    },
  });
}

/**
 * 读取后台工具状态和最近记录。
 */
export async function listAdminToolDefinitions(
  projectKey = DEFAULT_PROJECT_KEY
) {
  const currentProject = await seedDefaultToolConfigProject({ projectKey });
  const tools = await db
    .select()
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, currentProject.id),
        ne(toolRegistry.toolKey, "storage")
      )
    )
    .orderBy(toolRegistry.sortOrder, toolRegistry.toolKey);

  const items = await Promise.all(
    tools.map(async (tool) => {
      const [fieldCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(toolConfigField)
        .where(
          and(
            eq(toolConfigField.projectId, currentProject.id),
            eq(toolConfigField.toolKey, tool.toolKey)
          )
        );
      const [featureCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(toolFeature)
        .where(
          and(
            eq(toolFeature.projectId, currentProject.id),
            eq(toolFeature.toolKey, tool.toolKey)
          )
        );
      const [storageRuleCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(toolStorageRule)
        .where(
          and(
            eq(toolStorageRule.projectId, currentProject.id),
            eq(toolStorageRule.toolKey, tool.toolKey)
          )
        );
      const [runtimeTokenRow] = await db
        .select({
          lastUsedAt: toolRuntimeToken.lastUsedAt,
        })
        .from(toolRuntimeToken)
        .where(
          and(
            eq(toolRuntimeToken.projectId, currentProject.id),
            eq(toolRuntimeToken.toolKey, tool.toolKey)
          )
        )
        .orderBy(
          desc(toolRuntimeToken.lastUsedAt),
          desc(toolRuntimeToken.updatedAt)
        )
        .limit(1);
      const [lastRequest] = await db
        .select({
          createdAt: aiRequestLog.createdAt,
          featureKey: aiRequestLog.featureKey,
          status: aiRequestLog.status,
        })
        .from(aiRequestLog)
        .where(eq(aiRequestLog.toolKey, tool.toolKey))
        .orderBy(desc(aiRequestLog.createdAt))
        .limit(1);
      const [lastLog] = await db
        .select({
          action: toolDefinitionImportLog.action,
          createdAt: toolDefinitionImportLog.createdAt,
          summaryJson: toolDefinitionImportLog.summaryJson,
        })
        .from(toolDefinitionImportLog)
        .where(
          and(
            eq(toolDefinitionImportLog.projectId, currentProject.id),
            eq(toolDefinitionImportLog.toolKey, tool.toolKey)
          )
        )
        .orderBy(desc(toolDefinitionImportLog.createdAt))
        .limit(1);

      return {
        tool,
        status: {
          fieldCount: Number(fieldCount?.count ?? 0),
          featureCount: Number(featureCount?.count ?? 0),
          storageRuleCount: Number(storageRuleCount?.count ?? 0),
          lastRuntimeUseAt: runtimeTokenRow?.lastUsedAt ?? null,
          lastAIRequestAt: lastRequest?.createdAt ?? null,
          lastAIRequestFeature: lastRequest?.featureKey ?? null,
          lastAIRequestStatus: lastRequest?.status ?? null,
          lastImportAction: lastLog?.action ?? null,
          lastImportAt: lastLog?.createdAt ?? null,
          lastImportSummary: lastLog?.summaryJson ?? null,
        },
      };
    })
  );

  return {
    project: currentProject,
    tools: items,
  };
}

async function applyToolDefinition(
  projectId: string,
  definition: ImportedToolDefinition
) {
  const now = new Date();
  const metadata = {
    entry: definition.entry,
    runtimeMode: definition.runtimeMode,
    authMode: definition.authMode,
    billingMode: definition.billingMode,
    storageMode: definition.storageMode,
    capabilities: definition.capabilities,
  };
  const [existingTool] = await db
    .select({ id: toolRegistry.id })
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, projectId),
        eq(toolRegistry.toolKey, definition.toolKey)
      )
    )
    .limit(1);

  if (existingTool) {
    await db
      .update(toolRegistry)
      .set({
        name: definition.name,
        description: definition.description,
        metadata,
        enabled: definition.enabled ?? true,
        sortOrder: definition.sortOrder ?? 100,
        updatedAt: now,
      })
      .where(eq(toolRegistry.id, existingTool.id));
  } else {
    await db.insert(toolRegistry).values({
      id: crypto.randomUUID(),
      projectId,
      toolKey: definition.toolKey,
      name: definition.name,
      description: definition.description,
      metadata,
      enabled: definition.enabled ?? true,
      sortOrder: definition.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    });
  }

  await syncToolFields(projectId, definition, now);
  await syncToolFeatures(projectId, definition, now);
  await syncToolStorageRules(projectId, definition, now);
  await syncToolPricingRules(definition, now);
}

async function syncToolFields(
  projectId: string,
  definition: ImportedToolDefinition,
  now: Date
) {
  const expectedFieldKeys = definition.fields.map((field) => field.fieldKey);
  if (expectedFieldKeys.length > 0) {
    await db
      .delete(toolConfigValue)
      .where(
        and(
          eq(toolConfigValue.projectId, projectId),
          eq(toolConfigValue.toolKey, definition.toolKey),
          notInArray(toolConfigValue.fieldKey, expectedFieldKeys)
        )
      );
    await db
      .delete(toolConfigField)
      .where(
        and(
          eq(toolConfigField.projectId, projectId),
          eq(toolConfigField.toolKey, definition.toolKey),
          notInArray(toolConfigField.fieldKey, expectedFieldKeys)
        )
      );
  }

  for (const [index, field] of definition.fields.entries()) {
    const [existingField] = await db
      .select({ id: toolConfigField.id })
      .from(toolConfigField)
      .where(
        and(
          eq(toolConfigField.projectId, projectId),
          eq(toolConfigField.toolKey, definition.toolKey),
          eq(toolConfigField.fieldKey, field.fieldKey)
        )
      )
      .limit(1);
    const fieldValues = {
      projectId,
      toolKey: definition.toolKey,
      fieldKey: field.fieldKey,
      label: field.label,
      description: field.description ?? null,
      group: field.group,
      type: field.type,
      required: field.required ?? false,
      adminOnly: field.adminOnly ?? false,
      userOverridable: field.userOverridable ?? false,
      defaultValueJson: field.defaultValueJson,
      optionsJson: field.optionsJson,
      validationJson: field.validationJson,
      sortOrder: field.sortOrder ?? (index + 1) * 10,
      enabled: true,
      updatedAt: now,
    };

    if (existingField) {
      await db
        .update(toolConfigField)
        .set(fieldValues)
        .where(eq(toolConfigField.id, existingField.id));
      continue;
    }

    await db.insert(toolConfigField).values({
      id: crypto.randomUUID(),
      ...fieldValues,
      createdAt: now,
    });
  }
}

async function syncToolFeatures(
  projectId: string,
  definition: ImportedToolDefinition,
  now: Date
) {
  const expectedFeatureKeys = definition.features.map(
    (feature) => feature.featureKey
  );
  if (expectedFeatureKeys.length > 0) {
    await db
      .delete(toolFeature)
      .where(
        and(
          eq(toolFeature.projectId, projectId),
          eq(toolFeature.toolKey, definition.toolKey),
          notInArray(toolFeature.featureKey, expectedFeatureKeys)
        )
      );
  }

  for (const [index, feature] of definition.features.entries()) {
    const [existingFeature] = await db
      .select({ id: toolFeature.id })
      .from(toolFeature)
      .where(
        and(
          eq(toolFeature.projectId, projectId),
          eq(toolFeature.toolKey, definition.toolKey),
          eq(toolFeature.featureKey, feature.featureKey)
        )
      )
      .limit(1);
    const featureValues = {
      projectId,
      toolKey: definition.toolKey,
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

async function syncToolStorageRules(
  projectId: string,
  definition: ImportedToolDefinition,
  now: Date
) {
  const expectedPurposes = definition.storage.prefixRules.map(
    (rule) => rule.purpose
  );
  if (expectedPurposes.length > 0) {
    await db
      .delete(toolStorageRule)
      .where(
        and(
          eq(toolStorageRule.projectId, projectId),
          eq(toolStorageRule.toolKey, definition.toolKey),
          notInArray(toolStorageRule.purpose, expectedPurposes)
        )
      );
  } else {
    await db
      .delete(toolStorageRule)
      .where(
        and(
          eq(toolStorageRule.projectId, projectId),
          eq(toolStorageRule.toolKey, definition.toolKey)
        )
      );
  }

  for (const rule of definition.storage.prefixRules) {
    const [existingRule] = await db
      .select({ id: toolStorageRule.id })
      .from(toolStorageRule)
      .where(
        and(
          eq(toolStorageRule.projectId, projectId),
          eq(toolStorageRule.toolKey, definition.toolKey),
          eq(toolStorageRule.purpose, rule.purpose)
        )
      )
      .limit(1);
    const ruleValues = {
      projectId,
      toolKey: definition.toolKey,
      purpose: rule.purpose,
      prefix: rule.prefix,
      retentionClass: rule.retentionClass,
      ttlHours: rule.ttlHours,
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

async function syncToolPricingRules(
  definition: ImportedToolDefinition,
  now: Date
) {
  const expectedFeatureKeys = definition.features.map(
    (feature) => feature.featureKey
  );
  if (expectedFeatureKeys.length > 0) {
    await db
      .delete(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, definition.toolKey),
          eq(aiPricingRule.modelScope, "any"),
          notInArray(aiPricingRule.featureKey, expectedFeatureKeys)
        )
      );
  }

  for (const feature of definition.features) {
    const [existingRule] = await db
      .select({ id: aiPricingRule.id })
      .from(aiPricingRule)
      .where(
        and(
          eq(aiPricingRule.toolKey, definition.toolKey),
          eq(aiPricingRule.featureKey, feature.featureKey),
          eq(aiPricingRule.requestType, feature.requestType),
          eq(aiPricingRule.modelScope, "any")
        )
      )
      .limit(1);
    const ruleValues = {
      toolKey: definition.toolKey,
      featureKey: feature.featureKey,
      requestType: feature.requestType,
      billingMode: feature.pricing.billingMode,
      modelScope: "any" as const,
      fixedCredits: feature.pricing.fixedCredits ?? null,
      inputTokensPerCredit: feature.pricing.inputTokensPerCredit ?? null,
      outputTokensPerCredit: feature.pricing.outputTokensPerCredit ?? null,
      minimumCredits: feature.pricing.minimumCredits,
      enabled: feature.enabled ?? true,
      updatedAt: now,
    };

    if (existingRule) {
      await db
        .update(aiPricingRule)
        .set(ruleValues)
        .where(eq(aiPricingRule.id, existingRule.id));
      continue;
    }

    await db.insert(aiPricingRule).values({
      id: crypto.randomUUID(),
      costUsdPerCredit: null,
      createdAt: now,
      ...ruleValues,
    });
  }
}

async function snapshotToolDefinition(projectId: string, toolKey: string) {
  const [tool] = await db
    .select()
    .from(toolRegistry)
    .where(
      and(
        eq(toolRegistry.projectId, projectId),
        eq(toolRegistry.toolKey, toolKey)
      )
    )
    .limit(1);
  const fields = await db
    .select()
    .from(toolConfigField)
    .where(
      and(
        eq(toolConfigField.projectId, projectId),
        eq(toolConfigField.toolKey, toolKey)
      )
    );
  const features = await db
    .select()
    .from(toolFeature)
    .where(
      and(
        eq(toolFeature.projectId, projectId),
        eq(toolFeature.toolKey, toolKey)
      )
    );
  const storageRules = await db
    .select()
    .from(toolStorageRule)
    .where(
      and(
        eq(toolStorageRule.projectId, projectId),
        eq(toolStorageRule.toolKey, toolKey)
      )
    );
  const pricingRules = await db
    .select()
    .from(aiPricingRule)
    .where(eq(aiPricingRule.toolKey, toolKey));

  return {
    tool: tool ?? null,
    fields,
    features,
    storageRules,
    pricingRules,
  } satisfies ToolDefinitionSnapshot;
}

async function applySnapshot(
  projectId: string,
  toolKey: string,
  snapshot: ToolDefinitionSnapshot
) {
  if (!snapshot.tool) {
    await db.delete(aiPricingRule).where(eq(aiPricingRule.toolKey, toolKey));
    await db
      .delete(toolFeature)
      .where(
        and(
          eq(toolFeature.projectId, projectId),
          eq(toolFeature.toolKey, toolKey)
        )
      );
    await db
      .delete(toolStorageRule)
      .where(
        and(
          eq(toolStorageRule.projectId, projectId),
          eq(toolStorageRule.toolKey, toolKey)
        )
      );
    await db
      .delete(toolConfigValue)
      .where(
        and(
          eq(toolConfigValue.projectId, projectId),
          eq(toolConfigValue.toolKey, toolKey)
        )
      );
    await db
      .delete(toolConfigField)
      .where(
        and(
          eq(toolConfigField.projectId, projectId),
          eq(toolConfigField.toolKey, toolKey)
        )
      );
    await db
      .delete(toolRegistry)
      .where(
        and(
          eq(toolRegistry.projectId, projectId),
          eq(toolRegistry.toolKey, toolKey)
        )
      );
    return;
  }

  const metadata = readSnapshotMetadata(snapshot.tool.metadata);
  const definition: ImportedToolDefinition = {
    toolKey: snapshot.tool.toolKey,
    name: snapshot.tool.name,
    description: snapshot.tool.description ?? "",
    entry: metadata.entry ?? {
      type: "api_only",
      url: "",
    },
    runtimeMode: metadata.runtimeMode ?? "none",
    authMode: metadata.authMode ?? "platform_session",
    billingMode: metadata.billingMode ?? "none",
    storageMode: metadata.storageMode ?? "none",
    capabilities: metadata.capabilities ?? {
      adminConfig: false,
      userConfig: false,
      credits: false,
      ai: false,
      storage: false,
    },
    enabled: snapshot.tool.enabled,
    sortOrder: snapshot.tool.sortOrder,
    fields: snapshot.fields.map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      description: field.description ?? undefined,
      group: field.group,
      type: field.type,
      required: field.required,
      adminOnly: field.adminOnly,
      userOverridable: field.userOverridable,
      defaultValueJson:
        field.defaultValueJson as ImportedToolDefinition["fields"][number]["defaultValueJson"],
      optionsJson: field.optionsJson as string[] | undefined,
      validationJson: field.validationJson ?? undefined,
      sortOrder: field.sortOrder,
    })),
    features: snapshot.features.map((feature) => {
      const pricing = snapshot.pricingRules.find(
        (rule) =>
          rule.featureKey === feature.featureKey && rule.modelScope === "any"
      );
      if (!pricing) {
        throw new Error(`缺少 ${feature.featureKey} 的计费规则快照`);
      }
      return {
        featureKey: feature.featureKey,
        name: feature.name,
        description: feature.description ?? undefined,
        requestType: feature.requestType,
        defaultOperation: feature.defaultOperation ?? undefined,
        requiredCapabilities: feature.requiredCapabilities ?? undefined,
        enabled: feature.enabled,
        sortOrder: feature.sortOrder,
        pricing: {
          billingMode: pricing.billingMode,
          minimumCredits: pricing.minimumCredits,
          fixedCredits: pricing.fixedCredits ?? undefined,
          inputTokensPerCredit: pricing.inputTokensPerCredit ?? undefined,
          outputTokensPerCredit: pricing.outputTokensPerCredit ?? undefined,
        },
      };
    }),
    storage: {
      prefixRules: snapshot.storageRules.map((rule) => ({
        prefix: rule.prefix,
        purpose: rule.purpose,
        retentionClass: rule.retentionClass,
        ttlHours: rule.ttlHours ?? 24,
        enabled: rule.enabled,
        maxSizeBytes: rule.maxSizeBytes ?? undefined,
        contentTypes: rule.contentTypes ?? undefined,
      })),
    },
  };

  await applyToolDefinition(projectId, definition);
}

async function bumpProjectRevision(projectId: string) {
  await db
    .update(project)
    .set({
      configRevision: sql`${project.configRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(project.id, projectId));
}

function serializeSnapshot(snapshot: ToolDefinitionSnapshot) {
  return JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
}

function readSnapshotMetadata(metadata: unknown) {
  const record =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)
      : {};

  return {
    entry:
      typeof record.entry === "object" && record.entry !== null
        ? (record.entry as ImportedToolDefinition["entry"])
        : undefined,
    runtimeMode:
      typeof record.runtimeMode === "string"
        ? (record.runtimeMode as ImportedToolDefinition["runtimeMode"])
        : undefined,
    authMode:
      typeof record.authMode === "string"
        ? (record.authMode as ImportedToolDefinition["authMode"])
        : undefined,
    billingMode:
      typeof record.billingMode === "string"
        ? (record.billingMode as ImportedToolDefinition["billingMode"])
        : undefined,
    storageMode:
      typeof record.storageMode === "string"
        ? (record.storageMode as ImportedToolDefinition["storageMode"])
        : undefined,
    capabilities:
      typeof record.capabilities === "object" && record.capabilities !== null
        ? (record.capabilities as ImportedToolDefinition["capabilities"])
        : undefined,
  };
}
