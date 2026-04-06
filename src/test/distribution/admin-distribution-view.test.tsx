// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminDistributionView } from "@/features/distribution/components/admin-distribution-view";

const { executeMock, refreshMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  refreshMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    execute: executeMock,
    isPending: false,
  }),
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

describe("AdminDistributionView", () => {
  beforeEach(() => {
    executeMock.mockReset();
    refreshMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("renders admin summary", () => {
    render(
      <AdminDistributionView
        data={{
          summary: {
            activeAgents: 6,
            attributedOrders: 18,
            pendingWithdrawals: 2,
            totalCommission: 18600,
            availableCommission: 7200,
            frozenCommission: 5300,
          },
          agentBalances: [],
          graph: [
            {
              profileId: "profile-1",
              userId: "user-1",
              displayName: "北区代理",
              userName: "北区代理",
              email: "agent@example.com",
              agentLevel: "L1",
              status: "active",
              depth: 1,
              path: "root/user-1",
              inviterUserId: null,
              balance: {
                currency: "CNY",
                totalEarned: 8600,
                availableAmount: 3600,
                frozenAmount: 1800,
                withdrawnAmount: 1200,
              },
              stats: {
                directChildren: 1,
                totalDescendants: 1,
                attributedOrders: 3,
                subscriptionOrders: 1,
                creditOrders: 2,
                grossSales: 32900,
              },
              recentOrders: [],
              children: [],
            },
          ],
          recentOrders: [],
          recentCommissions: [],
          recentWithdrawals: [],
        }}
      />
    );

    expect(screen.getByText("分销、佣金与提现后台")).toBeInTheDocument();
    expect(screen.getByText("活跃代理")).toBeInTheDocument();
    expect(screen.getByText("推广成交订单")).toBeInTheDocument();
    expect(screen.getByText("累计佣金")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "分销图" })).toBeInTheDocument();
  });

  it("submits paid review for pending withdrawal", async () => {
    render(
      <AdminDistributionView
        data={{
          summary: {
            activeAgents: 6,
            attributedOrders: 18,
            pendingWithdrawals: 1,
            totalCommission: 18600,
            availableCommission: 7200,
            frozenCommission: 5300,
          },
          agentBalances: [],
          graph: [],
          recentOrders: [],
          recentCommissions: [],
          recentWithdrawals: [
            {
              id: "withdraw-1",
              userId: "user-1",
              amount: 5000,
              feeAmount: 100,
              netAmount: 4900,
              currency: "USD",
              status: "pending",
              operatorNote: null,
              payeeSnapshot: {
                channel: "alipay",
                accountName: "张三",
                accountNo: "zhangsan@example.com",
              },
              createdAt: new Date("2026-04-06T10:00:00Z"),
              reviewedAt: null,
              paidAt: null,
              userName: "北区代理",
              userEmail: "agent@example.com",
            },
          ],
        }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "提现审核" }));
    fireEvent.click(screen.getByRole("tab", { name: "提现审核" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("填写审核备注或打款说明")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("填写审核备注或打款说明"), {
      target: { value: "已线下打款" },
    });
    fireEvent.click(screen.getByRole("button", { name: "标记打款" }));

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith({
        requestId: "withdraw-1",
        decision: "paid",
        note: "已线下打款",
      });
    });
  });
});
