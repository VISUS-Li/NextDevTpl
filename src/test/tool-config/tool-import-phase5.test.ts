import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postDisable } from "@/app/api/platform/tools/[toolKey]/disable/route";
import { POST as postRollback } from "@/app/api/platform/tools/[toolKey]/rollback/route";
import { POST as postImport } from "@/app/api/platform/tools/import/route";
import { GET as getTools } from "@/app/api/platform/tools/route";
import { project } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  generateTestId,
  testDb,
} from "../utils";

const createdUserIds: string[] = [];
const projectKey = generateTestId("tool_import_phase5");

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await testDb.delete(project).where(eq(project.key, projectKey));
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

/**
 * 模拟管理员会话。
 */
function mockAdminSession(user: { id: string; name: string; email: string }) {
  vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: {
      id: `session_${user.id}`,
      token: `token_${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      ...user,
      role: "admin",
    },
  } as never);
}

describe("Tool import phase 5", () => {
  it("后台应支持导入、停用、回滚工具定义并返回状态列表", async () => {
    const admin = await createTestUser({
      email: `1183989659+tool-import-phase5-${Date.now()}@qq.com`,
      name: "工具导入阶段五管理员",
      role: "admin",
    });
    createdUserIds.push(admin.id);
    mockAdminSession(admin);

    const definition = {
      toolKey: "notes-ai",
      name: "Notes AI",
      description: "会议纪要工具",
      entry: {
        type: "external_url",
        url: "https://notes.example.com",
      },
      runtimeMode: "platform_ai",
      authMode: "launch_ticket",
      billingMode: "ai_gateway",
      storageMode: "platform_storage",
      capabilities: {
        adminConfig: true,
        userConfig: true,
        credits: true,
        ai: true,
        storage: true,
      },
      fields: [
        {
          fieldKey: "config1",
          label: "默认模型",
          group: "config",
          type: "string",
          userOverridable: true,
          defaultValueJson: "gpt-4o-mini",
        },
      ],
      features: [
        {
          featureKey: "summary",
          name: "摘要生成",
          requestType: "chat",
          defaultOperation: "text.generate",
          requiredCapabilities: ["text"],
          pricing: {
            billingMode: "token_based",
            minimumCredits: 1,
            inputTokensPerCredit: 800,
            outputTokensPerCredit: 400,
          },
        },
      ],
      storage: {
        prefixRules: [
          {
            prefix: "notes-ai/temp/",
            purpose: "notes_temp",
            retentionClass: "temporary",
            ttlHours: 48,
            enabled: true,
          },
        ],
      },
    };

    const importResponse = await postImport(
      new Request("http://localhost:3000/api/platform/tools/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectKey,
          definition,
        }),
      })
    );
    const importBody = await importResponse.json();

    expect(importResponse.status).toBe(200);
    expect(importBody).toMatchObject({
      success: true,
      toolKey: "notes-ai",
    });

    const listAfterImport = await getTools(
      new Request(
        `http://localhost:3000/api/platform/tools?projectKey=${projectKey}`
      )
    );
    const listAfterImportBody = await listAfterImport.json();
    const importedTool = listAfterImportBody.tools.find(
      (item: { tool: { toolKey: string } }) => item.tool.toolKey === "notes-ai"
    );

    expect(listAfterImport.status).toBe(200);
    expect(importedTool).toMatchObject({
      tool: {
        toolKey: "notes-ai",
        enabled: true,
      },
      status: {
        fieldCount: 1,
        featureCount: 1,
        storageRuleCount: 1,
        lastImportAction: "import",
      },
    });

    const disableResponse = await postDisable(
      new Request(
        `http://localhost:3000/api/platform/tools/notes-ai/disable?projectKey=${projectKey}`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({
          toolKey: "notes-ai",
        }),
      }
    );
    expect(disableResponse.status).toBe(200);

    const rollbackResponse = await postRollback(
      new Request(
        `http://localhost:3000/api/platform/tools/notes-ai/rollback?projectKey=${projectKey}`,
        {
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({
          toolKey: "notes-ai",
        }),
      }
    );
    expect(rollbackResponse.status).toBe(200);

    const listAfterRollback = await getTools(
      new Request(
        `http://localhost:3000/api/platform/tools?projectKey=${projectKey}`
      )
    );
    const listAfterRollbackBody = await listAfterRollback.json();
    const rolledBackTool = listAfterRollbackBody.tools.find(
      (item: { tool: { toolKey: string } }) => item.tool.toolKey === "notes-ai"
    );

    expect(rolledBackTool).toMatchObject({
      tool: {
        toolKey: "notes-ai",
        enabled: true,
      },
      status: {
        lastImportAction: "rollback",
      },
    });
  });
});
