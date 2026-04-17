"use server";

import { revalidatePath } from "next/cache";
import {
  disableToolDefinition,
  importToolDefinition,
  rollbackToolDefinition,
} from "@/features/tool-config/definition-admin";
import {
  importToolDefinitionSchema,
  saveAdminToolConfigSchema,
  saveUserToolConfigSchema,
  toolDefinitionActionSchema,
} from "@/features/tool-config/schema";
import {
  saveAdminToolConfig,
  saveUserToolConfig,
} from "@/features/tool-config/service";
import { adminAction, protectedAction } from "@/lib/safe-action";

const withToolConfigAdminAction = (name: string) =>
  adminAction.metadata({ action: `toolConfig.admin.${name}` });

const withToolConfigUserAction = (name: string) =>
  protectedAction.metadata({ action: `toolConfig.user.${name}` });

/**
 * 保存管理员工具配置
 */
export const saveAdminToolConfigAction = withToolConfigAdminAction("saveConfig")
  .schema(saveAdminToolConfigSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const revision = await saveAdminToolConfig({
      projectKey: data.projectKey,
      toolKey: data.tool,
      actorId: ctx.userId,
      values: data.values,
      clearSecrets: data.clearSecrets,
    });

    revalidatePath("/admin/tool-config");
    revalidatePath("/admin/storage");

    return {
      message: "工具配置已保存",
      revision,
    };
  });

/**
 * 导入工具定义
 */
export const importToolDefinitionAction = withToolConfigAdminAction(
  "importDefinition"
)
  .schema(importToolDefinitionSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const result = await importToolDefinition({
      projectKey: data.projectKey,
      actorId: ctx.userId,
      definition: data.definition,
    });

    revalidatePath("/admin/tool-config");
    revalidatePath("/admin/ai");
    revalidatePath("/admin/storage");

    return {
      message: "工具定义已导入",
      toolKey: result.tool?.toolKey ?? data.definition.toolKey,
    };
  });

/**
 * 停用工具定义
 */
export const disableToolDefinitionAction = withToolConfigAdminAction(
  "disableDefinition"
)
  .schema(toolDefinitionActionSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    await disableToolDefinition({
      projectKey: data.projectKey,
      toolKey: data.tool,
      actorId: ctx.userId,
    });

    revalidatePath("/admin/tool-config");

    return {
      message: "工具已停用",
      toolKey: data.tool,
    };
  });

/**
 * 回滚工具定义
 */
export const rollbackToolDefinitionAction = withToolConfigAdminAction(
  "rollbackDefinition"
)
  .schema(toolDefinitionActionSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    await rollbackToolDefinition({
      projectKey: data.projectKey,
      toolKey: data.tool,
      actorId: ctx.userId,
    });

    revalidatePath("/admin/tool-config");
    revalidatePath("/admin/ai");
    revalidatePath("/admin/storage");

    return {
      message: "工具定义已回滚",
      toolKey: data.tool,
    };
  });

/**
 * 保存用户工具配置
 */
export const saveUserToolConfigAction = withToolConfigUserAction("saveConfig")
  .schema(saveUserToolConfigSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const revision = await saveUserToolConfig({
      projectKey: data.projectKey,
      toolKey: data.tool,
      actorId: ctx.userId,
      values: data.values,
      clearSecrets: data.clearSecrets,
    });

    revalidatePath("/dashboard/settings");

    return {
      message: "我的工具配置已保存",
      revision,
    };
  });
