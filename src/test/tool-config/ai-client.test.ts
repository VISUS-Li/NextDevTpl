import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatCreateMock, openaiConstructorMock } = vi.hoisted(() => ({
  chatCreateMock: vi.fn(
    async (payload: { model: string }): Promise<unknown> => ({
      choices: [
        {
          message: {
            content: `model:${payload.model}`,
          },
        },
      ],
    })
  ),
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
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
    expect(result.output?.image).toBe(
      "https://example.com/generated-image.png"
    );
  });

  it("nano-banana 应走 images/generations 接口", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "nano-banana",
        task_status: "succeed",
        task_id: "task_banana_001",
        data: [
          {
            url: "https://example.com/nano-banana.png",
            revised_prompt: "生成海报",
          },
        ],
        usage: {
          input_tokens: 12,
          output_tokens: 345,
          total_tokens: 357,
        },
      }),
    } as Response);

    const { chatCompletionWithUsage } = await import("@/lib/ai/openai");
    const result = await chatCompletionWithUsage(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "生成海报" },
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/source.png",
              },
            },
          ],
        },
      ],
      {
        aiConfig: {
          provider: "openai",
          apiKey: "user-key",
          baseUrl: "https://ai.example.com/v1",
          model: "nano-banana",
        },
        extraBody: {
          modalities: ["image"],
          image_generation: true,
          image: { aspect_ratio: "3:4" },
        },
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.example.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer user-key",
        }),
      })
    );
    expect(openaiConstructorMock).not.toHaveBeenCalled();
    expect(result.model).toBe("nano-banana");
    expect(result.output?.image).toBe("https://example.com/nano-banana.png");
    expect(result.output?.images).toEqual([
      { url: "https://example.com/nano-banana.png" },
    ]);
    expect(result.usage.totalTokens).toBe(357);
  });

  it("nano-banana 任务查询应走 images 路径", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "nano-banana",
        task_id: "task_banana_002",
        task_status: "succeed",
        data: [
          {
            url: "https://example.com/nano-banana-result.png",
          },
        ],
      }),
    } as Response);

    const { retrieveChatCompletionWithUsage } = await import("@/lib/ai/openai");
    const result = await retrieveChatCompletionWithUsage("task_banana_002", {
      aiConfig: {
        provider: "openai",
        apiKey: "user-key",
        baseUrl: "https://ai.example.com/v1",
        model: "nano-banana",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.example.com/v1/images/task_banana_002",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer user-key",
        }),
      })
    );
    expect(result.status).toBe("completed");
    expect(result.output?.image).toBe(
      "https://example.com/nano-banana-result.png"
    );
    expect(result.output?.images).toEqual([
      { url: "https://example.com/nano-banana-result.png" },
    ]);
  });

  it("显式声明 image.edit 时应走 images/edits 接口", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "gpt-image-1",
        task_status: "succeed",
        task_id: "task_edit_001",
        data: [
          {
            url: "https://example.com/edited-image.png",
            revised_prompt: "编辑后的海报",
          },
        ],
      }),
    } as Response);

    const { chatCompletionWithUsage } = await import("@/lib/ai/openai");
    const result = await chatCompletionWithUsage(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "把这张图改成暖色海报" },
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/source.png",
              },
            },
          ],
        },
      ],
      {
        aiConfig: {
          provider: "openai",
          apiKey: "user-key",
          baseUrl: "https://ai.example.com/v1",
          model: "gpt-image-1",
          endpointType: "images_edits",
          pollType: "image",
          operation: "image.edit",
        },
        extraBody: {
          image: {
            mask: "https://example.com/mask.png",
            size: "1024x1024",
          },
          background: "transparent",
        },
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.example.com/v1/images/edits",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(result.output?.image).toBe("https://example.com/edited-image.png");
    expect(result.content).toBe("编辑后的海报");
  });

  it("显式声明 video.generate 时应走视频任务创建和轮询接口", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "veo-3",
          task_id: "task_video_001",
          task_status: "pending",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "veo-3",
          task_id: "task_video_001",
          task_status: "succeed",
          video_result: {
            url: "https://example.com/generated-video.mp4",
            revised_prompt: "视频生成完成",
          },
        }),
      } as Response);

    const { chatCompletionWithUsage, retrieveChatCompletionWithUsage } =
      await import("@/lib/ai/openai");
    const created = await chatCompletionWithUsage(
      [
        {
          role: "user",
          content: [{ type: "text", text: "生成 5 秒城市延时视频" }],
        },
      ],
      {
        aiConfig: {
          provider: "openai",
          apiKey: "user-key",
          baseUrl: "https://ai.example.com/v1",
          model: "veo-3",
          endpointType: "videos_generations",
          pollType: "video",
          operation: "video.generate",
        },
        extraBody: {
          async: true,
          video: { aspect_ratio: "16:9", duration: 5 },
        },
      }
    );
    const result = await retrieveChatCompletionWithUsage("task_video_001", {
      aiConfig: {
        provider: "openai",
        apiKey: "user-key",
        baseUrl: "https://ai.example.com/v1",
        model: "veo-3",
        pollType: "video",
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://ai.example.com/v1/videos/generations",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://ai.example.com/v1/videos/task_video_001",
      expect.objectContaining({
        method: "GET",
      })
    );
    expect(created.task).toEqual({
      id: "task_video_001",
      status: "pending",
    });
    expect(result.status).toBe("completed");
    expect(result.output?.video).toBe(
      "https://example.com/generated-video.mp4"
    );
  });
});
