import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getRevision } from "@/app/api/platform/tool-config/revision/route";
import { POST as postRuntime } from "@/app/api/platform/tool-config/runtime/route";
import { POST as postRuntimeSave } from "@/app/api/platform/tool-config/runtime-save/route";
import { GET as getLaunch } from "@/app/api/platform/tools/[toolKey]/launch/route";
import { POST as postExchange } from "@/app/api/platform/tools/session/exchange/route";
import { project } from "@/db/schema";
import { seedDefaultToolConfigProject } from "@/features/tool-config";
import { createToolRuntimeToken } from "@/features/tool-config/runtime-auth";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  generateTestId,
  testDb,
} from "../utils";

const createdUserIds: string[] = [];

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await testDb.delete(project).where(eq(project.key, projectKey));
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

const projectKey = generateTestId("tool_runtime_phase4");

/**
 * 模拟当前用户会话。
 */
function mockSession(user: { id: string; name: string; email: string }) {
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

describe("Tool runtime phase 4", () => {
  it("外部工具应通过 launch ticket 和工具级 token 完成身份交换与运行时配置读写", async () => {
    const user = await createTestUser({
      email: `1183989659+tool-runtime-phase4-${Date.now()}@qq.com`,
      name: "工具运行时阶段四用户",
    });
    createdUserIds.push(user.id);
    await seedDefaultToolConfigProject({ projectKey });
    await createToolRuntimeToken({
      projectKey,
      toolKey: "jingfang-ai",
      name: "phase4-jingfang",
      token: "phase4-runtime-token",
      scopes: ["runtime:read", "runtime:write", "session:exchange"],
    });
    mockSession(user);

    const launchResponse = await getLaunch(
      new Request(
        `http://localhost:3000/api/platform/tools/jingfang-ai/launch?projectKey=${projectKey}`
      ),
      {
        params: Promise.resolve({
          toolKey: "jingfang-ai",
        }),
      }
    );
    const launchBody = await launchResponse.json();

    expect(launchResponse.status).toBe(200);
    expect(launchBody.success).toBe(true);
    expect(launchBody.launchUrl).toContain("ticket=");

    const exchangeResponse = await postExchange(
      new Request("http://localhost:3000/api/platform/tools/session/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer phase4-runtime-token",
        },
        body: JSON.stringify({
          projectKey,
          tool: "jingfang-ai",
          ticket: launchBody.ticket,
        }),
      })
    );
    const exchangeBody = await exchangeResponse.json();

    expect(exchangeResponse.status).toBe(200);
    expect(exchangeBody).toMatchObject({
      success: true,
      toolKey: "jingfang-ai",
      user: {
        id: user.id,
        email: user.email,
      },
    });

    const saveResponse = await postRuntimeSave(
      new Request(
        "http://localhost:3000/api/platform/tool-config/runtime-save",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer phase4-runtime-token",
          },
          body: JSON.stringify({
            projectKey,
            tool: "jingfang-ai",
            userId: user.id,
            values: {
              config1: "yunwu",
            },
          }),
        }
      )
    );
    const saveBody = await saveResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(saveBody.success).toBe(true);

    const runtimeResponse = await postRuntime(
      new Request("http://localhost:3000/api/platform/tool-config/runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer phase4-runtime-token",
        },
        body: JSON.stringify({
          projectKey,
          tool: "jingfang-ai",
          userId: user.id,
          knownRevision: saveBody.revision - 1,
        }),
      })
    );
    const runtimeBody = await runtimeResponse.json();

    expect(runtimeResponse.status).toBe(200);
    expect(runtimeBody.config).toMatchObject({
      config1: "yunwu",
    });

    const revisionResponse = await getRevision(
      new Request(
        `http://localhost:3000/api/platform/tool-config/revision?projectKey=${projectKey}&tool=jingfang-ai`,
        {
          headers: {
            Authorization: "Bearer phase4-runtime-token",
          },
        }
      )
    );
    const revisionBody = await revisionResponse.json();

    expect(revisionResponse.status).toBe(200);
    expect(revisionBody.revision).toBe(saveBody.revision);
  });
});
