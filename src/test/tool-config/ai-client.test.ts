import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatCreateMock, openaiConstructorMock } = vi.hoisted(() => ({
  chatCreateMock: vi.fn(async (payload: { model: string }): Promise<unknown> => ({
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
    vi.restoreAllMocks();
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

  it("应该把仅返回 pending 任务的异步图片响应视为有效结果", async () => {
    chatCreateMock.mockResolvedValueOnce({
      id: "task_image_001",
      status: "pending",
      model: "gemini-2.5-flash",
      object: "chat.completion",
    });

    const { chatCompletionWithUsage } = await import("@/lib/ai/openai");
    const result = await chatCompletionWithUsage(
      [
        {
          role: "user",
          content: "生成商品图",
        },
      ],
      {
        aiConfig: {
          provider: "openai",
          apiKey: "user-key",
          baseUrl: "https://ai.example.com/v1",
          model: "gemini-2.5-flash",
        },
        extraBody: {
          modalities: ["image"],
          background: true,
          image: { aspect_ratio: "3:4" },
        },
      }
    );

    expect(result.content).toBe("");
    expect(result.status).toBe("pending");
    expect(result.task).toEqual({
      id: "task_image_001",
      status: "pending",
    });
  });

  it("应该按极客智坊后台任务接口查询结果并归一化 succeed 状态", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "task_image_002",
          status: "succeed",
          model: "gemini-2.5-flash",
          choices: [
            {
              message: {
                role: "assistant",
                image: "https://example.com/generated-image.png",
              },
            },
          ],
        }),
      } as Response);

    const { retrieveChatCompletionWithUsage } = await import("@/lib/ai/openai");
    const result = await retrieveChatCompletionWithUsage("task_image_002", {
      aiConfig: {
        provider: "openai",
        apiKey: "user-key",
        baseUrl: "https://ai.example.com/v1",
        model: "gemini-2.5-flash",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.example.com/v1/chat/task_image_002",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer user-key",
        }),
      })
    );
    expect(result.status).toBe("completed");
    expect(result.task).toBeNull();
    expect(result.output?.image).toBe("https://example.com/generated-image.png");
  });
});
