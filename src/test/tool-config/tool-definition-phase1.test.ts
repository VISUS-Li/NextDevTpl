import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { project, toolConfigField, toolRegistry } from "@/db/schema";
import { getStoragePolicyConfig } from "@/features/storage/records";
import {
  getAdminToolConfigPageData,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import { generateTestId, testDb } from "../utils";

describe("Tool definition phase 1", () => {
  const projectKey = generateTestId("tool_definition_phase1");

  afterAll(async () => {
    await testDb.delete(project).where(eq(project.key, projectKey));
  });

  it("应该把内置工具定义写入工具注册和字段定义", async () => {
    await seedDefaultToolConfigProject({
      projectKey,
      name: "Tool Definition P1",
    });
    const [currentProject] = await testDb
      .select({ id: project.id })
      .from(project)
      .where(eq(project.key, projectKey))
      .limit(1);
    expect(currentProject).toBeDefined();

    const [redinkTool] = await testDb
      .select()
      .from(toolRegistry)
      .where(
        and(
          eq(toolRegistry.toolKey, "redink"),
          eq(toolRegistry.projectId, currentProject?.id ?? "")
        )
      )
      .limit(1);

    const [catalogField] = await testDb
      .select()
      .from(toolConfigField)
      .where(
        and(
          eq(toolConfigField.toolKey, "redink"),
          eq(toolConfigField.fieldKey, "json4")
        )
      )
      .limit(1);

    expect(redinkTool?.metadata).toMatchObject({
      entry: {
        type: "internal_route",
        url: "/dashboard/tools/redink",
      },
      runtimeMode: "custom_adapter",
      billingMode: "ai_gateway",
    });
    expect(catalogField).toMatchObject({
      label: "redink.userModelCatalog",
      adminOnly: true,
      userOverridable: false,
    });
  });

  it("应该让页面编辑器返回工具定义里的展示标签", async () => {
    await seedDefaultToolConfigProject({
      projectKey,
      name: "Tool Definition P1",
    });

    const pageData = await getAdminToolConfigPageData(projectKey);
    const jingfangConfig = pageData.toolConfigs.find(
      (item) => item.tool.toolKey === "jingfang-ai"
    );

    expect(
      jingfangConfig?.editor.fields.find(
        (field) => field.fieldKey === "config1"
      )
    ).toMatchObject({
      fieldKey: "config1",
      settingLabel: "聊天平台",
    });
    expect(
      jingfangConfig?.editor.fields.find(
        (field) => field.fieldKey === "secret6"
      )
    ).toMatchObject({
      fieldKey: "secret6",
      settingLabel: "高级设置密码",
    });
  });

  it("应该继续按工具定义补齐默认运行时配置", async () => {
    await seedDefaultToolConfigProject({
      projectKey,
      name: "Tool Definition P1",
    });

    const pageData = await getAdminToolConfigPageData(projectKey);
    const storagePolicy = await getStoragePolicyConfig(projectKey);

    expect(
      pageData.toolConfigs.some((item) => item.tool.toolKey === "storage")
    ).toBe(false);
    expect(storagePolicy).toMatchObject({
      ephemeralHours: 6,
      temporaryDays: 3,
      longTermDays: 90,
    });
    expect(Array.isArray(storagePolicy.prefixRules)).toBe(true);
    expect(
      storagePolicy.prefixRules.some(
        (item) => item.prefix === "platform/ai-assets/request/"
      )
    ).toBe(true);
  });
});
