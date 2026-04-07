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

export type ToolConfigValueInput = z.infer<typeof toolConfigValueSchema>;
