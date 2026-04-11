// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminToolConfigView } from "@/features/tool-config/components/admin-tool-config-view";

const { executeMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    execute: executeMock,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

describe("AdminToolConfigView", () => {
  beforeEach(() => {
    executeMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("应该渲染管理员工具配置并提交非空字段", async () => {
    render(
      <AdminToolConfigView
        data={{
          project: {
            key: "nextdevtpl",
            name: "NextDevTpl",
            configRevision: 8,
          },
          toolConfigs: [
            {
              tool: {
                toolKey: "redink",
                name: "RedInk",
                description: "小红书内容工具",
                enabled: true,
              },
              editor: {
                projectKey: "nextdevtpl",
                revision: 8,
                fields: [
                  {
                    fieldKey: "config1",
                    label: "config1",
                    settingLabel: "聊天平台",
                    description: null,
                    group: "config",
                    type: "string",
                    value: "deepseek-chat",
                    source: "default",
                    options: null,
                    required: false,
                    editable: true,
                  },
                  {
                    fieldKey: "secret1",
                    label: "secret1",
                    settingLabel: "主聊天 API Key",
                    description: null,
                    group: "secret",
                    type: "secret",
                    secretSet: true,
                    source: "project_admin",
                    options: null,
                    required: true,
                    editable: true,
                  },
                  {
                    fieldKey: "config10",
                    label: "config10",
                    settingLabel: "AI 资源访问方式",
                    description: null,
                    group: "config",
                    type: "select",
                    value: null,
                    source: "project_admin",
                    options: ["public", "proxy"],
                    required: false,
                    editable: true,
                  },
                  {
                    fieldKey: "json4",
                    label: "json4",
                    settingLabel: "用户可见模型目录",
                    description: null,
                    group: "json",
                    type: "json",
                    value: {
                      mode: "strict",
                      enabled: true,
                      count: 2,
                    },
                    source: "project_admin",
                    options: null,
                    required: false,
                    editable: true,
                  },
                  {
                    fieldKey: "text1",
                    label: "text1",
                    settingLabel: "text1",
                    description: null,
                    group: "text",
                    type: "textarea",
                    value: "默认提示词",
                    source: "project_admin",
                    options: null,
                    required: false,
                    editable: true,
                  },
                ],
              },
            },
          ],
        }}
      />
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "工具配置" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("已设置密钥，留空不会覆盖旧值。")
    ).toBeInTheDocument();

    const jsonViewSwitch = screen.getByRole("switch", {
      name: "用户可见模型目录 JSON 视图切换",
    });
    expect(screen.getByText("槽位：config1")).toBeInTheDocument();
    expect(jsonViewSwitch).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByLabelText("用户可见模型目录.mode 值")
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("deepseek-chat"), {
      target: { value: "gemini-2.5-pro" },
    });
    fireEvent.change(screen.getByDisplayValue(/"mode": "strict"/), {
      target: {
        value: '{\n  "mode": "relaxed",\n  "enabled": true,\n  "count": 2\n}',
      },
    });
    fireEvent.click(jsonViewSwitch);
    fireEvent.change(screen.getByLabelText("用户可见模型目录.mode 值"), {
      target: { value: "relaxed" },
    });
    expect(jsonViewSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("用户可见模型目录.mode 值")).toHaveValue(
      "relaxed"
    );
    fireEvent.change(screen.getByLabelText("text1"), {
      target: { value: "新的管理员提示词" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 RedInk 配置" }));

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith({
        projectKey: "nextdevtpl",
        tool: "redink",
        values: {
          config1: "gemini-2.5-pro",
          json4: {
            mode: "relaxed",
            enabled: true,
            count: 2,
          },
          text1: "新的管理员提示词",
        },
        clearSecrets: [],
      });
    });
  });

  it("应该在 JSON 无效时提示错误且不提交", () => {
    render(
      <AdminToolConfigView
        data={{
          project: {
            key: "nextdevtpl",
            name: "NextDevTpl",
            configRevision: 8,
          },
          toolConfigs: [
            {
              tool: {
                toolKey: "redink",
                name: "RedInk",
                description: "小红书内容工具",
                enabled: true,
              },
              editor: {
                projectKey: "nextdevtpl",
                revision: 8,
                fields: [
                  {
                    fieldKey: "json4",
                    label: "json4",
                    settingLabel: "用户可见模型目录",
                    description: null,
                    group: "json",
                    type: "json",
                    value: {
                      mode: "strict",
                    },
                    source: "project_admin",
                    options: null,
                    required: false,
                    editable: true,
                  },
                ],
              },
            },
          ],
        }}
      />
    );

    fireEvent.change(screen.getByDisplayValue(/"mode": "strict"/), {
      target: { value: '{"mode": "broken"' },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 RedInk 配置" }));

    expect(executeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "用户可见模型目录 不是有效的 JSON"
    );
  });
});
