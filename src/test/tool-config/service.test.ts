import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { project, toolConfigAuditLog, toolConfigValue } from "@/db/schema";
import {
  getResolvedToolConfig,
  getToolConfigEditorData,
  getToolConfigRevision,
  saveAdminToolConfig,
  saveUserToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import {
  cleanupTestUsers,
  createTestUser,
  generateTestId,
  testDb,
} from "../utils";

describe("Tool config service", () => {
  const projectKey = generateTestId("tool_config_project");
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await testDb.delete(project).where(eq(project.key, projectKey));
    await cleanupTestUsers(createdUserIds);
  });

  it("应该解析管理员默认配置和用户覆盖配置", async () => {
    const admin = await createTestUser({ role: "admin" });
    const user = await createTestUser();
    createdUserIds.push(admin.id, user.id);

    await seedDefaultToolConfigProject({
      projectKey,
      name: "Tool Config Test",
    });
    const firstRevision = await getToolConfigRevision(projectKey);

    const adminRevision = await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: admin.id,
      values: {
        config1: "deepseek",
        secret1: "admin-secret",
        config2: "deepseek-chat",
        text1: "管理员默认提示词",
      },
    });

    const adminResolved = await getResolvedToolConfig({
      projectKey,
      toolKey: "redink",
    });

    expect(adminRevision).toBe(firstRevision + 1);
    expect(adminResolved.config).toMatchObject({
      config1: "deepseek",
      secret1: "admin-secret",
      config2: "deepseek-chat",
      text1: "管理员默认提示词",
    });

    const userEditor = await getToolConfigEditorData({
      projectKey,
      toolKey: "redink",
      userId: user.id,
      mode: "user",
    });
    const apiKeyField = userEditor.fields.find(
      (field) => field.fieldKey === "secret1"
    );

    expect(apiKeyField).toMatchObject({
      type: "secret",
      secretSet: true,
      source: "project_admin",
    });
    expect(apiKeyField).not.toHaveProperty("value");

    const userRevision = await saveUserToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: user.id,
      values: {
        secret1: "user-secret",
        config2: "gpt-user",
        text1: "用户自己的提示词",
      },
    });
    const userResolved = await getResolvedToolConfig({
      projectKey,
      toolKey: "redink",
      userId: user.id,
    });

    expect(userRevision).toBe(adminRevision + 1);
    expect(userResolved.config).toMatchObject({
      config1: "deepseek",
      secret1: "user-secret",
      config2: "gpt-user",
      text1: "用户自己的提示词",
    });

    await saveUserToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: user.id,
      values: {},
      clearSecrets: ["secret1"],
    });
    const fallbackResolved = await getResolvedToolConfig({
      projectKey,
      toolKey: "redink",
      userId: user.id,
    });

    expect(fallbackResolved.config).toMatchObject({
      secret1: "admin-secret",
    });
  });

  it("应该保存 jingfang-ai 的通用槽位并记录配置审计", async () => {
    const admin = await createTestUser({ role: "admin" });
    const user = await createTestUser();
    createdUserIds.push(admin.id, user.id);

    await saveAdminToolConfig({
      projectKey,
      toolKey: "jingfang-ai",
      actorId: admin.id,
      values: {
        secret1: "admin-jingfang-secret",
        config1: "https://download.test",
      },
    });

    await saveUserToolConfig({
      projectKey,
      toolKey: "jingfang-ai",
      actorId: user.id,
      values: {
        config1: "https://user-download.test",
      },
    });

    const values = await testDb
      .select()
      .from(toolConfigValue)
      .where(eq(toolConfigValue.toolKey, "jingfang-ai"));
    const auditLogs = await testDb
      .select()
      .from(toolConfigAuditLog)
      .where(eq(toolConfigAuditLog.toolKey, "jingfang-ai"));

    expect(
      values.some(
        (value) =>
          value.fieldKey === "config1" &&
          value.scope === "user" &&
          value.userId === user.id
      )
    ).toBe(true);
    expect(auditLogs.length).toBeGreaterThan(0);
  });

  it("应该支持管理员设置新用户注册奖励积分", async () => {
    const admin = await createTestUser({ role: "admin" });
    createdUserIds.push(admin.id);

    await seedDefaultToolConfigProject({
      projectKey,
      name: "Tool Config Test",
    });

    const initialConfig = await getResolvedToolConfig({
      projectKey,
      toolKey: "platform",
    });
    expect(initialConfig.config.config1).toBe(200);

    await saveAdminToolConfig({
      projectKey,
      toolKey: "platform",
      actorId: admin.id,
      values: {
        config1: 80,
      },
    });

    const updatedConfig = await getResolvedToolConfig({
      projectKey,
      toolKey: "platform",
    });
    expect(updatedConfig.config.config1).toBe(80);
  });
});
