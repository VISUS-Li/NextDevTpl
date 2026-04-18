import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { GET as getEditor } from "@/app/api/platform/tool-config/editor/route";
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
const projectKey = generateTestId("redink_phaseA_user_settings");

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

describe("RedInk 阶段 A 用户配置接口", () => {
  it("用户读取设置时只应看到提示词字段", async () => {
    const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const admin = await createTestUser({
      role: "admin",
      email: `1183989659+redink-phaseA-admin-${testSuffix}@qq.com`,
      name: "RedInk 阶段 A 管理员",
    });
    const user = await createTestUser({
      email: `1183989659+redink-phaseA-user-${testSuffix}@qq.com`,
      name: "RedInk 阶段 A 用户",
    });
    createdUserIds.push(admin.id, user.id);

    await seedDefaultToolConfigProject({ projectKey });
    await saveAdminToolConfig({
      projectKey,
      toolKey: "redink",
      actorId: admin.id,
      values: {
        config1: "deepseek-chat",
        config2: "priority_failover",
        config3: "geekai",
        secret1: "admin-secret",
        json1: ["deepseek-chat"],
        json2: {
          "product-copy": {
            enabled: true,
            billingMode: "token_based",
            minimumCredits: 2,
          },
        },
        json3: ["geekai"],
        text2: "请偏向真实分享口吻",
      },
    });

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
      body.fields.map((field: { settingLabel: string }) => field.settingLabel)
    ).toEqual([
      "商品图片理解提示词",
      "商品文案生成提示词",
      "商品发布文案提示词",
      "商品发布图基础提示词",
    ]);
    expect(JSON.stringify(body)).not.toContain("config1");
    expect(JSON.stringify(body)).not.toContain("secret1");
    expect(JSON.stringify(body)).not.toContain("json1");
  });

  it("用户通过接口保存时不能写入管理员字段，只能保存提示词字段", async () => {
    const user = await createTestUser({
      email: `1183989659+redink-phaseA-block-${Date.now()}@qq.com`,
      name: "RedInk 阶段 A 限制用户",
    });
    createdUserIds.push(user.id);

    await seedDefaultToolConfigProject({ projectKey });
    mockSession({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    });

    const successResponse = await postUserConfig(
      new Request("http://localhost:3000/api/platform/tool-config/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectKey,
          tool: "redink",
          values: {
            text3: "正文里多写使用场景和购买理由",
          },
        }),
      })
    );
    const successBody = await successResponse.json();

    expect(successResponse.status).toBe(200);
    expect(successBody.success).toBe(true);

    await expect(
      postUserConfig(
        new Request("http://localhost:3000/api/platform/tool-config/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectKey,
            tool: "redink",
            values: {
              config1: "gpt-4o-mini",
            },
          }),
        })
      )
    ).rejects.toThrow("当前用户不能修改该配置字段");
  });
});
