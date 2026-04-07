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
                    fieldKey: "ai.model",
                    label: "AI 模型",
                    description: null,
                    group: "ai",
                    type: "string",
                    value: "gpt-4o-mini",
                    source: "default",
                    options: null,
                    required: false,
                    editable: true,
                  },
                  {
                    fieldKey: "ai.apiKey",
                    label: "AI API Key",
                    description: null,
                    group: "ai",
                    type: "secret",
                    secretSet: true,
                    source: "project_admin",
                    options: null,
                    required: true,
                    editable: true,
                  },
                  {
                    fieldKey: "redink.systemPrompt",
                    label: "系统提示词",
                    description: null,
                    group: "tool",
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

    expect(screen.getByRole("heading", { level: 1, name: "工具配置" })).toBeInTheDocument();
    expect(screen.getByText("已设置密钥，留空不会覆盖旧值。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("AI 模型"), {
      target: { value: "deepseek-chat" },
    });
    fireEvent.change(screen.getByLabelText("系统提示词"), {
      target: { value: "新的管理员提示词" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 RedInk 配置" }));

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith({
        projectKey: "nextdevtpl",
        tool: "redink",
        values: {
          "ai.model": "deepseek-chat",
          "redink.systemPrompt": "新的管理员提示词",
        },
        clearSecrets: [],
      });
    });
  });
});
