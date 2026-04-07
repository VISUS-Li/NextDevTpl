// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserToolConfigSection } from "@/features/tool-config/components/user-tool-config-section";

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

describe("UserToolConfigSection", () => {
  beforeEach(() => {
    executeMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("应该只提交用户自己的工具配置", async () => {
    render(
      <UserToolConfigSection
        data={{
          project: {
            key: "nextdevtpl",
            name: "NextDevTpl",
          },
          toolConfigs: [
            {
              tool: {
                toolKey: "redink",
                name: "RedInk",
                description: "小红书内容工具",
              },
              editor: {
                revision: 5,
                fields: [
                  {
                    fieldKey: "ai.model",
                    label: "AI 模型",
                    description: null,
                    group: "ai",
                    type: "string",
                    value: "gpt-4o-mini",
                    source: "project_admin",
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
                    description: "个人提示词",
                    group: "tool",
                    type: "textarea",
                    value: "",
                    source: "empty",
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

    expect(screen.getByRole("heading", { level: 2, name: "工具配置" })).toBeInTheDocument();
    expect(screen.getByText("当前使用管理员默认值。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("AI 模型"), {
      target: { value: "user-model" },
    });
    fireEvent.change(screen.getByLabelText("系统提示词"), {
      target: { value: "用户提示词" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存我的 RedInk 配置" }));

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith({
        projectKey: "nextdevtpl",
        tool: "redink",
        values: {
          "ai.model": "user-model",
          "redink.systemPrompt": "用户提示词",
        },
        clearSecrets: [],
      });
    });
  });
});
