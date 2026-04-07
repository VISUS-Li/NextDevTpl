import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatCreateMock, openaiConstructorMock } = vi.hoisted(() => ({
  chatCreateMock: vi.fn(async (payload: { model: string }) => ({
    choices: [
      {
        message: {
          content: `model:${payload.model}`,
        },
      },
    ],
  })),
  openaiConstructorMock: vi.fn(function OpenAIMock() {
    return {
      chat: {
        completions: {
          create: chatCreateMock,
        },
      },
    };
  }),
}));

vi.mock("openai", () => ({
  default: openaiConstructorMock,
}));

describe("AI client config", () => {
  beforeEach(() => {
    chatCreateMock.mockClear();
    openaiConstructorMock.mockClear();
  });

  it("应该按工具配置创建请求级 AI 客户端", async () => {
    const { chatCompletion } = await import("@/lib/ai/openai");

    const content = await chatCompletion(
      [
        {
          role: "user",
          content: "hello",
        },
      ],
      {
        aiConfig: {
          provider: "deepseek",
          apiKey: "user-key",
          baseUrl: "https://ai.example.com/v1",
          model: "tool-user-model",
        },
        temperature: 0.2,
        maxTokens: 128,
      }
    );

    expect(content).toBe("model:tool-user-model");
    expect(openaiConstructorMock).toHaveBeenLastCalledWith({
      apiKey: "user-key",
      baseURL: "https://ai.example.com/v1",
    });
    expect(chatCreateMock).toHaveBeenCalledWith({
      model: "tool-user-model",
      messages: [
        {
          role: "user",
          content: "hello",
        },
      ],
      temperature: 0.2,
      max_tokens: 128,
    });
  });
});
