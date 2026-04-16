// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAIGatewayView } from "@/features/ai-gateway/components/admin-ai-gateway-view";

const { refreshMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

describe("AdminAIGatewayView", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("应支持通过界面新增 Provider 并执行健康检查", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";

        if (url === "/api/platform/ai/admin/providers" && method === "POST") {
          return createJsonResponse({
            success: true,
            provider: {
              id: "provider_new",
            },
          });
        }

        if (url === "/api/platform/ai/summary" && method === "GET") {
          return createJsonResponse({
            success: true,
            overview: {
              totalRequests: 2,
              successRequests: 2,
              failedRequests: 0,
              insufficientCredits: 0,
              totalProviderCostMicros: 500,
              totalChargedCredits: 6,
            },
          });
        }

        if (url === "/api/platform/ai/admin/providers" && method === "GET") {
          return createJsonResponse({
            success: true,
            providers: [
              {
                id: "provider_1",
                key: "geek-default",
                name: "Geek Default",
                baseUrl: "https://geek.test/v1",
                enabled: true,
                priority: 1,
                weight: 100,
                requestType: "chat",
                lastHealthStatus: "healthy",
                totalAttempts: 2,
                successAttempts: 2,
                failedAttempts: 0,
                averageLatencyMs: 300,
                totalProviderCostMicros: 500,
              },
            ],
          });
        }

        if (
          url === "/api/platform/ai/admin/providers/health-check" &&
          method === "POST"
        ) {
          return createJsonResponse({
            success: true,
            results: [
              {
                providerId: "provider_1",
                providerKey: "geek-default",
                ok: true,
                status: "healthy",
                message: "健康检查通过",
              },
            ],
          });
        }

        throw new Error(`未处理的请求: ${method} ${url}`);
      }
    );

    vi.stubGlobal("fetch", fetchMock);

    render(
      <AdminAIGatewayView
        initialOverview={{
          totalRequests: 1,
          successRequests: 1,
          failedRequests: 0,
          insufficientCredits: 0,
          totalProviderCostMicros: 100,
          totalChargedCredits: 3,
        }}
        initialProviders={[
          {
            id: "provider_1",
            key: "geek-default",
            name: "Geek Default",
            baseUrl: "https://geek.test/v1",
            enabled: true,
            priority: 1,
            weight: 100,
            requestType: "chat",
            lastHealthStatus: "healthy",
            totalAttempts: 1,
            successAttempts: 1,
            failedAttempts: 0,
            averageLatencyMs: 200,
            totalProviderCostMicros: 100,
          },
        ]}
        initialBindings={[]}
        initialPricingRules={[]}
        initialRequests={[]}
      />
    );

    fireEvent.change(screen.getByLabelText("Provider Key"), {
      target: { value: "yunwu-main" },
    });
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Yunwu Main" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://yunwu.test/v1" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "yunwu-key" },
    });

    fireEvent.click(screen.getByRole("button", { name: "新增 Provider" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/platform/ai/admin/providers",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(toastSuccessMock).toHaveBeenCalledWith("Provider 已创建");

    const [healthCheckButton] = screen.getAllByRole("button", {
      name: "健康检查",
    });
    expect(healthCheckButton).toBeDefined();
    fireEvent.click(healthCheckButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/platform/ai/admin/providers/health-check",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(toastSuccessMock).toHaveBeenCalledWith("健康检查完成，共 1 条结果");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("应从会话缓存恢复模型绑定草稿和当前页签", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const initialProps = {
      initialOverview: {
        totalRequests: 1,
        successRequests: 1,
        failedRequests: 0,
        insufficientCredits: 0,
        totalProviderCostMicros: 100,
        totalChargedCredits: 3,
      },
      initialProviders: [
        {
          id: "provider_1",
          key: "geek-default",
          name: "Geek Default",
          baseUrl: "https://geek.test/v1",
          enabled: true,
          priority: 1,
          weight: 100,
          requestType: "chat" as const,
          lastHealthStatus: "healthy",
          totalAttempts: 1,
          successAttempts: 1,
          failedAttempts: 0,
          averageLatencyMs: 200,
          totalProviderCostMicros: 100,
        },
      ],
      initialBindings: [],
      initialPricingRules: [],
      initialRequests: [],
    };

    window.sessionStorage.setItem(
      "ai-admin-active-tab",
      JSON.stringify("bindings")
    );
    window.sessionStorage.setItem(
      "ai-admin-binding-form",
      JSON.stringify({
        providerId: "provider_1",
        modelKey: "gpt-4o-mini",
        modelAlias: "openai/gpt-4o-mini",
        capabilities: ["text"],
        enabled: "true",
        priority: "100",
        weight: "100",
        costMode: "manual",
        inputCostPer1k: "0",
        outputCostPer1k: "0",
        fixedCostUsd: "0",
        maxRetries: "0",
        timeoutMs: "30000",
      })
    );

    render(<AdminAIGatewayView {...initialProps} />);

    expect(screen.getByRole("tab", { name: "模型绑定" })).toHaveAttribute(
      "data-state",
      "active"
    );
    const [restoredModelKeyInput, restoredModelAliasInput] =
      screen.getAllByRole("textbox");
    expect(restoredModelKeyInput).toHaveValue("gpt-4o-mini");
    expect(restoredModelAliasInput).toHaveValue("openai/gpt-4o-mini");
  });
});

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
