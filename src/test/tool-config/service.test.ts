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
import { cleanupTestUsers, createTestUser, generateTestId, testDb } from "../utils";

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

    await seedDefaultToolConfigProject({ projectKey, name: "Tool Config Test" });
    const firstRevision = await getToolConfigRevision(projectKey);

    const adminRevision = await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: admin.id,
      values: {
        "ai.provider": "deepseek",
        "ai.apiKey": "admin-secret",
        "ai.model": "deepseek-chat",
        "redink.systemPrompt": "管理员默认提示词",
      },
    });

    const adminResolved = await getResolvedToolConfig({
      projectKey,
      toolKey: "redink",
    });

    expect(adminRevision).toBe(firstRevision + 1);
    expect(adminResolved.config).toMatchObject({
      ai: {
        provider: "deepseek",
        apiKey: "admin-secret",
        model: "deepseek-chat",
      },
      redink: {
        systemPrompt: "管理员默认提示词",
      },
    });

    const userEditor = await getToolConfigEditorData({
      projectKey,
      toolKey: "redink",
      userId: user.id,
      mode: "user",
    });
    const apiKeyField = userEditor.fields.find(
      (field) => field.fieldKey === "ai.apiKey"
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
        "ai.apiKey": "user-secret",
        "ai.model": "gpt-user",
        "redink.systemPrompt": "用户自己的提示词",
      },
    });
    const userResolved = await getResolvedToolConfig({
      projectKey,
      toolKey: "redink",
      userId: user.id,
    });

    expect(userRevision).toBe(adminRevision + 1);
    expect(userResolved.config).toMatchObject({
      ai: {
        provider: "deepseek",
        apiKey: "user-secret",
        model: "gpt-user",
      },
      redink: {
        systemPrompt: "用户自己的提示词",
      },
    });

    await saveUserToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: user.id,
      values: {},
      clearSecrets: ["ai.apiKey"],
    });
    const fallbackResolved = await getResolvedToolConfig({
      projectKey,
      toolKey: "redink",
      userId: user.id,
    });

    expect(fallbackResolved.config).toMatchObject({
      ai: {
        apiKey: "admin-secret",
      },
    });
  });

  it("应该拒绝用户修改管理员专属字段并记录配置审计", async () => {
    const admin = await createTestUser({ role: "admin" });
    const user = await createTestUser();
    createdUserIds.push(admin.id, user.id);

    await saveAdminToolConfig({
      projectKey,
      toolKey: "jingfang-ai",
      actorId: admin.id,
      values: {
        "ai.apiKey": "admin-jingfang-secret",
        "jingfangAi.videoDownloadBaseUrl": "https://download.test",
      },
    });

    await expect(
      saveUserToolConfig({
        projectKey,
        toolKey: "jingfang-ai",
        actorId: user.id,
        values: {
          "jingfangAi.videoDownloadBaseUrl": "https://user-download.test",
        },
      })
    ).rejects.toThrow("当前用户不能修改该配置字段");

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
          value.fieldKey === "jingfangAi.videoDownloadBaseUrl" &&
          value.scope === "project_admin"
      )
    ).toBe(true);
    expect(auditLogs.length).toBeGreaterThan(0);
  });
});
