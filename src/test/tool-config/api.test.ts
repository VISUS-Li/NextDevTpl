import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { GET as getEditor } from "@/app/api/platform/tool-config/editor/route";
import { GET as getRevision } from "@/app/api/platform/tool-config/revision/route";
import { POST as postRuntime } from "@/app/api/platform/tool-config/runtime/route";
import { POST as postRuntimeSave } from "@/app/api/platform/tool-config/runtime-save/route";
import { POST as postUserConfig } from "@/app/api/platform/tool-config/user/route";
import { project } from "@/db/schema";
import {
  saveAdminToolConfig,
  seedDefaultToolConfigProject,
} from "@/features/tool-config";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  generateTestId,
  testDb,
} from "../utils";

const createdUserIds: string[] = [];
const projectKey = generateTestId("tool_config_api_project");

afterAll(async () => {
  await testDb.delete(project).where(eq(project.key, projectKey));
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

function mockSession(user: {
  id: string;
  name: string;
  email: string;
  role?: string;
}) {
  vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: {
      id: `session_${user.id}`,
      token: `token_${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user,
  } as never);
}

describe("Tool config platform API", () => {
  it("应该支持工具页面读取保存配置，并让服务端运行时读取最终配置", async () => {
    const admin = await createTestUser({ role: "admin" });
    const user = await createTestUser();
    createdUserIds.push(admin.id, user.id);
    process.env.TOOL_CONFIG_RUNTIME_TOKEN = "runtime-test-token";

    await seedDefaultToolConfigProject({ projectKey });
    await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: admin.id,
      values: {
        config1: "deepseek",
        secret1: "admin-runtime-secret",
        config2: "deepseek-chat",
      },
    });
    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    });

    const editorResponse = await getEditor(
      new Request(
        `http://localhost:3000/api/platform/tool-config/editor?projectKey=${projectKey}&tool=redink`
      )
    );
    const editor = await editorResponse.json();

    expect(editorResponse.status).toBe(200);
    expect(editor.success).toBe(true);
    expect(
      editor.fields.find(
        (field: { fieldKey: string }) => field.fieldKey === "secret1"
      )
    ).toMatchObject({
      secretSet: true,
      source: "project_admin",
    });
    expect(JSON.stringify(editor)).not.toContain("admin-runtime-secret");

    const saveResponse = await postUserConfig(
      new Request("http://localhost:3000/api/platform/tool-config/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectKey,
          tool: "redink",
          values: {
            secret1: "user-runtime-secret",
            config2: "user-runtime-model",
          },
        }),
      })
    );
    const saved = await saveResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(saved.success).toBe(true);

    const runtimeResponse = await postRuntime(
      new Request("http://localhost:3000/api/platform/tool-config/runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer runtime-test-token",
        },
        body: JSON.stringify({
          projectKey,
          tool: "redink",
          userId: user.id,
          knownRevision: saved.revision - 1,
        }),
      })
    );
    const runtime = await runtimeResponse.json();

    expect(runtimeResponse.status).toBe(200);
    expect(runtimeResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(runtime.changed).toBe(true);
    expect(runtime.config).toMatchObject({
      config1: "deepseek",
      secret1: "user-runtime-secret",
      config2: "user-runtime-model",
    });

    const revisionResponse = await getRevision(
      new Request(
        `http://localhost:3000/api/platform/tool-config/revision?projectKey=${projectKey}`,
        {
          headers: {
            Authorization: "Bearer runtime-test-token",
          },
        }
      )
    );
    const revision = await revisionResponse.json();

    expect(revisionResponse.status).toBe(200);
    expect(revision.revision).toBe(saved.revision);
  });

  it("运行时接口应该拒绝错误令牌", async () => {
    process.env.TOOL_CONFIG_RUNTIME_TOKEN = "runtime-test-token";

    const response = await postRuntime(
      new Request("http://localhost:3000/api/platform/tool-config/runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer bad-token",
        },
        body: JSON.stringify({
          projectKey,
          tool: "redink",
          userId: "user_1",
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("运行时保存接口应该支持外部工具按 userId 写入配置", async () => {
    process.env.TOOL_CONFIG_RUNTIME_TOKEN = "runtime-test-token";

    const response = await postRuntimeSave(
      new Request(
        "http://localhost:3000/api/platform/tool-config/runtime-save",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-test-token",
          },
          body: JSON.stringify({
            projectKey,
            tool: "jingfang-ai",
            userId: "external-user",
            values: {
              config1: "yunwu",
              secret1: "external-secret",
            },
          }),
        }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const runtimeResponse = await postRuntime(
      new Request("http://localhost:3000/api/platform/tool-config/runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer runtime-test-token",
        },
        body: JSON.stringify({
          projectKey,
          tool: "jingfang-ai",
          userId: "external-user",
        }),
      })
    );
    const runtime = await runtimeResponse.json();

    expect(runtimeResponse.status).toBe(200);
    expect(runtime.config).toMatchObject({
      config1: "yunwu",
      secret1: "external-secret",
    });
  });
});
