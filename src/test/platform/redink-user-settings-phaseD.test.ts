import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { GET as getEditor } from "@/app/api/platform/tool-config/editor/route";
import { project } from "@/db/schema";
import { seedDefaultToolConfigProject } from "@/features/tool-config";
import { auth } from "@/lib/auth";
import {
  cleanupTestUsers,
  createTestUser,
  generateTestId,
  testDb,
} from "../utils";

const createdUserIds: string[] = [];
const projectKey = generateTestId("redink_phaseD_prompt_settings");

afterAll(async () => {
  await testDb.delete(project).where(eq(project.key, projectKey));
  await cleanupTestUsers(createdUserIds);
  vi.restoreAllMocks();
});

/**
 * 模拟当前请求的登录用户。
 */
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

describe("RedInk 提示词模板设置", () => {
  it("用户读取设置时应只看到可直接编辑的完整模板", async () => {
    const user = await createTestUser({
      email: `1183989659+redink-phaseD-user-${Date.now()}@qq.com`,
      name: "RedInk 阶段 D 用户",
    });
    createdUserIds.push(user.id);

    await seedDefaultToolConfigProject({ projectKey });
    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    });

    const response = await getEditor(
      new Request(
        `http://localhost:3000/api/platform/tool-config/editor?projectKey=${projectKey}&tool=redink`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(
      body.fields.map((field: { fieldKey: string }) => field.fieldKey)
    ).toEqual(["text1", "text2", "text3", "text4"]);
    expect(
      body.fields.every(
        (field: { value: string; description: string }) =>
          field.value.includes("{") && field.description.includes("完整模板")
      )
    ).toBe(true);
  });
});
