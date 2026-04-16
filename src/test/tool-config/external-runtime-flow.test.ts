import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { POST as postRuntime } from "@/app/api/platform/tool-config/runtime/route";
import { POST as postRuntimeSave } from "@/app/api/platform/tool-config/runtime-save/route";
import { project } from "@/db/schema";
import { seedDefaultToolConfigProject } from "@/features/tool-config";
import { generateTestId, testDb } from "../utils";

describe("Tool config external runtime flow", () => {
  const projectKey = generateTestId("tool_config_external_project");

  afterAll(async () => {
    await testDb.delete(project).where(eq(project.key, projectKey));
  });

  it("应该模拟外部工具先保存再读取固定槽位配置", async () => {
    process.env.TOOL_CONFIG_RUNTIME_TOKEN = "runtime-test-token";
    await seedDefaultToolConfigProject({ projectKey });

    const saveResponse = await postRuntimeSave(
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
            userId: "jingfang-user-token",
            values: {
              config1: "yunwu",
              config2: "space-demo",
              secret1: "sk-geekai",
              secret2: "sk-yunwu",
            },
          }),
        }
      )
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
          tool: "jingfang-ai",
          userId: "jingfang-user-token",
          knownRevision: saved.revision - 1,
        }),
      })
    );
    const runtime = await runtimeResponse.json();

    expect(runtimeResponse.status).toBe(200);
    expect(runtime.changed).toBe(true);
    expect(runtime.config).toMatchObject({
      config1: "yunwu",
      config2: "space-demo",
      secret1: "sk-geekai",
      secret2: "sk-yunwu",
    });
  });
});
