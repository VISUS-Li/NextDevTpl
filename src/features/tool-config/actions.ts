"use server";

import { revalidatePath } from "next/cache";

import { saveAdminToolConfig } from "@/features/tool-config/service";
import { saveAdminToolConfigSchema } from "@/features/tool-config/schema";
import { adminAction } from "@/lib/safe-action";

const withToolConfigAdminAction = (name: string) =>
  adminAction.metadata({ action: `toolConfig.admin.${name}` });

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
