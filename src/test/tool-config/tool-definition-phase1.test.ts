import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { project, toolConfigField, toolRegistry } from "@/db/schema";
import {
  getAdminToolConfigPageData,
  getResolvedToolConfig,
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

    const storageConfig = await getResolvedToolConfig({
      projectKey,
      toolKey: "storage",
    });

    expect(storageConfig.config).toMatchObject({
      config1: 6,
      config2: 3,
      config3: 90,
    });
    expect(Array.isArray(storageConfig.config.json1)).toBe(true);
    expect(
      (storageConfig.config.json1 as Array<{ prefix: string }>).some(
        (item) => item.prefix === "redink/product-images-temp/"
      )
    ).toBe(true);
  });
});
