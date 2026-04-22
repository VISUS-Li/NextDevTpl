// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
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
    push: vi.fn(),
  }),
  usePathname: () => "/zh/admin/storage",
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("next/image", () => ({
  default: ({
    alt,
    unoptimized: _unoptimized,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    alt: string;
    unoptimized?: boolean;
  }) => (
    // biome-ignore lint/performance/noImgElement: 测试里只需要最小图片桩
    <img alt={alt} {...props} />
  ),
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
            cdnBaseUrl: "",
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
          recentPagination: {
            page: 1,
            pageSize: 50,
            total: 0,
            totalPages: 1,
          },
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

  it("应该在弹窗内预览最近资源并保留下载链接", async () => {
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
            cdnBaseUrl: "https://cdn.tripai.icu",
            appUrl: "https://platform.tripai.icu",
            aiProxyBaseUrl: "https://platform.tripai.icu",
            defaultAiUrlMode: "public",
            uploadExpiresSeconds: 300,
            ephemeralHours: 6,
            temporaryDays: 3,
            longTermDays: 90,
            prefixRules: [],
          },
          toolModes: [],
          summary: {
            totalObjects: 1,
            readyObjects: 1,
            pendingObjects: 0,
            deletedObjects: 0,
            expiredObjects: 0,
            totalSizeBytes: 1024,
            permanentCount: 0,
            longTermCount: 1,
            temporaryCount: 0,
            ephemeralCount: 0,
          },
          cleanupCandidates: [],
          recentObjects: [
            {
              id: "obj_1",
              bucket: "tripai",
              key: "uploads/demo.png",
              contentType: "image/png",
              size: 1024,
              ownerUserId: "user_1",
              ownerName: "tester",
              ownerEmail: "tester@example.com",
              toolKey: "redink",
              purpose: "image_preview",
              retentionClass: "long_term",
              expiresAt: null,
              requestId: "req_1",
              taskId: null,
              status: "ready",
              metadata: {
                source: "redink",
              },
              deletedAt: null,
              createdAt: "2026-04-19T08:00:00.000Z",
              updatedAt: "2026-04-19T08:00:00.000Z",
              links: {
                rawUrl: "https://cdn.tripai.icu/tripai/uploads/demo.png",
                previewUrl: "https://cdn.tripai.icu/tripai/uploads/demo.png",
                downloadUrl:
                  "https://cdn.tripai.icu/tripai/uploads/demo.png?download=1",
                previewable: true,
              },
            },
          ],
          recentPagination: {
            page: 1,
            pageSize: 50,
            total: 1,
            totalPages: 1,
          },
        }}
      />
    );

    expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute(
      "href",
      "https://cdn.tripai.icu/tripai/uploads/demo.png?download=1"
    );

    fireEvent.click(screen.getByRole("button", { name: "预览" }));

    expect(
      await screen.findByRole("heading", { name: "资源预览" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "uploads/demo.png" })
    ).toHaveAttribute("src", "https://cdn.tripai.icu/tripai/uploads/demo.png");
  });
});
