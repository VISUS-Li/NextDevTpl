import { z } from "zod";

export const toolConfigFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/);

export const toolConfigToolKeySchema = z.string().trim().min(1).max(80);

export const toolConfigProjectKeySchema = z.string().trim().min(1).max(80);

export const toolConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);

export const toolConfigValuesSchema = z.record(
  toolConfigFieldKeySchema,
  toolConfigValueSchema
);

export const toolConfigEditorQuerySchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  tool: toolConfigToolKeySchema,
});

export const saveUserToolConfigSchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  tool: toolConfigToolKeySchema,
  values: toolConfigValuesSchema,
  clearSecrets: z.array(toolConfigFieldKeySchema).default([]),
});

export const saveAdminToolConfigSchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  tool: toolConfigToolKeySchema,
  values: toolConfigValuesSchema,
  clearSecrets: z.array(toolConfigFieldKeySchema).default([]),
});

export const runtimeToolConfigSchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  tool: toolConfigToolKeySchema,
  userId: z.string().trim().min(1),
  knownRevision: z.number().int().positive().optional(),
});

export const runtimeSaveToolConfigSchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  tool: toolConfigToolKeySchema,
  userId: z.string().trim().min(1),
  values: toolConfigValuesSchema,
  clearSecrets: z.array(toolConfigFieldKeySchema).default([]),
});

const toolDefinitionFieldSchema = z.object({
  fieldKey: toolConfigFieldKeySchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500).optional(),
  group: z.string().trim().min(1).max(40),
  type: z.enum([
    "string",
    "textarea",
    "number",
    "boolean",
    "select",
    "json",
    "secret",
  ]),
  required: z.boolean().optional(),
  adminOnly: z.boolean().optional(),
  userOverridable: z.boolean().optional(),
  defaultValueJson: toolConfigValueSchema.optional(),
  optionsJson: z.array(z.string()).optional(),
  validationJson: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const toolDefinitionFeatureSchema = z.object({
  featureKey: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500).optional(),
  requestType: z.literal("chat"),
  defaultOperation: z.string().trim().min(1).max(120).optional(),
  requiredCapabilities: z.array(z.string().trim().min(1).max(80)).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  pricing: z.object({
    billingMode: z.enum(["fixed_credits", "token_based", "cost_plus"]),
    minimumCredits: z.number().int().nonnegative(),
    fixedCredits: z.number().int().positive().optional(),
    inputTokensPerCredit: z.number().int().positive().optional(),
    outputTokensPerCredit: z.number().int().positive().optional(),
  }),
});

const toolDefinitionStorageRuleSchema = z.object({
  prefix: z.string().trim().min(1).max(255),
  purpose: z.string().trim().min(1).max(80),
  retentionClass: z.enum(["permanent", "long_term", "temporary", "ephemeral"]),
  ttlHours: z.number().int().positive(),
  enabled: z.boolean(),
  maxSizeBytes: z.number().int().positive().optional(),
  contentTypes: z.array(z.string().trim().min(1).max(120)).optional(),
});

const toolDefinitionDocumentSchema = z.object({
  toolKey: toolConfigToolKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  entry: z.object({
    type: z.enum(["internal_route", "external_url", "api_only"]),
    url: z.string().trim().min(1).max(500),
  }),
  runtimeMode: z.enum([
    "none",
    "platform_api",
    "platform_ai",
    "custom_adapter",
  ]),
  authMode: z.enum(["platform_session", "launch_ticket"]),
  billingMode: z.enum(["none", "manual_credits", "ai_gateway"]),
  storageMode: z.enum(["none", "platform_storage"]),
  capabilities: z.object({
    adminConfig: z.boolean(),
    userConfig: z.boolean(),
    credits: z.boolean(),
    ai: z.boolean(),
    storage: z.boolean(),
  }),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  fields: z.array(toolDefinitionFieldSchema).default([]),
  features: z.array(toolDefinitionFeatureSchema).default([]),
  storage: z
    .object({
      prefixRules: z.array(toolDefinitionStorageRuleSchema).default([]),
    })
    .default({
      prefixRules: [],
    }),
});

export const importToolDefinitionSchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  definition: toolDefinitionDocumentSchema,
});

export const toolDefinitionActionSchema = z.object({
  projectKey: toolConfigProjectKeySchema.default("nextdevtpl"),
  tool: toolConfigToolKeySchema,
});

export type ToolConfigValueInput = z.infer<typeof toolConfigValueSchema>;
export type ImportedToolDefinition = z.infer<
  typeof toolDefinitionDocumentSchema
>;
