// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminStorageView } from "@/features/storage/components/admin-storage-view";

const {
  routerRefreshMock,
  saveStoragePolicyExecuteMock,
  saveToolConfigExecuteMock,
} = vi.hoisted(() => ({
  routerRefreshMock: vi.fn(),
  saveStoragePolicyExecuteMock: vi.fn(),
  saveToolConfigExecuteMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/features/storage/actions", () => ({
  saveStoragePolicyAction: {
    __kind: "storage-policy",
  },
}));

vi.mock("@/features/tool-config/actions", () => ({
  saveAdminToolConfigAction: {
    __kind: "tool-config",
  },
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: { __kind?: string }) => ({
    execute:
      action.__kind === "storage-policy"
        ? saveStoragePolicyExecuteMock
        : saveToolConfigExecuteMock,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("AdminStorageView", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    saveStoragePolicyExecuteMock.mockReset();
    saveToolConfigExecuteMock.mockReset();
  });

  it("应该通过独立 action 保存平台级存储策略", async () => {
    render(
      <AdminStorageView
        data={{
          project: {
            key: "nextdevtpl",
            name: "tripai",
            revision: 9,
          },
          config: {
            provider: "s3_compatible",
            vendor: "tos",
            endpoint: "https://tos.example.com",
            bucket: "tripai",
            publicBaseUrl: "https://assets.tripai.icu",
            appUrl: "https://platform.tripai.icu",
            aiProxyBaseUrl: "https://platform.tripai.icu",
            defaultAiUrlMode: "public",
            uploadExpiresSeconds: 300,
            ephemeralHours: 6,
            temporaryDays: 3,
            longTermDays: 90,
            prefixRules: [
              {
                prefix: "platform/ai-assets/request/",
                retentionClass: "ephemeral",
                ttlHours: 24,
                purpose: "ai_input_temp",
                enabled: true,
              },
            ],
          },
          toolModes: [],
          summary: {
            totalObjects: 0,
            readyObjects: 0,
            pendingObjects: 0,
            deletedObjects: 0,
            expiredObjects: 0,
            totalSizeBytes: 0,
            permanentCount: 0,
            longTermCount: 0,
            temporaryCount: 0,
            ephemeralCount: 0,
          },
          cleanupCandidates: [],
          recentObjects: [],
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("短期资源保留小时"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("前缀生命周期规则 JSON"), {
      target: {
        value:
          '[{"prefix":"platform/ai-assets/request/","retentionClass":"ephemeral","ttlHours":48,"purpose":"ai_input_temp","enabled":true}]',
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存生命周期策略" }));

    await waitFor(() => {
      expect(saveStoragePolicyExecuteMock).toHaveBeenCalledWith({
        projectKey: "nextdevtpl",
        policy: {
          ephemeralHours: 12,
          temporaryDays: 3,
          longTermDays: 90,
          prefixRules: [
            {
              prefix: "platform/ai-assets/request/",
              retentionClass: "ephemeral",
              ttlHours: 48,
              purpose: "ai_input_temp",
              enabled: true,
            },
          ],
        },
      });
    });
    expect(saveToolConfigExecuteMock).not.toHaveBeenCalled();
  });
});
