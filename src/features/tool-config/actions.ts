"use server";

import { revalidatePath } from "next/cache";

import {
  saveAdminToolConfig,
  saveUserToolConfig,
} from "@/features/tool-config/service";
import {
  saveAdminToolConfigSchema,
  saveUserToolConfigSchema,
} from "@/features/tool-config/schema";
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

    return {
      message: "工具配置已保存",
      revision,
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
