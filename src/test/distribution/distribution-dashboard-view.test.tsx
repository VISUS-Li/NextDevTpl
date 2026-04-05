// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { DistributionDashboardView } from "@/features/distribution/components/distribution-dashboard-view";

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

describe("DistributionDashboardView", () => {
  beforeEach(() => {
    executeMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("renders summary and referral codes", () => {
    render(
      <DistributionDashboardView
        data={{
          profile: {
            status: "active",
            agentLevel: "L1",
            displayName: "北区代理",
            depth: 1,
            boundAt: new Date("2026-04-06T10:00:00Z"),
            path: "root/u-agent-1",
          },
          balance: {
            currency: "USD",
            totalEarned: 12600,
            availableAmount: 5200,
            frozenAmount: 3200,
            withdrawnAmount: 3000,
            reversedAmount: 1200,
          },
          referralCodes: [
            {
              id: "code-1",
              code: "TRIP-AGENT",
              campaign: "spring",
              landingPath: "/pricing",
              status: "active",
              createdAt: new Date("2026-04-06T10:00:00Z"),
            },
          ],
          orders: [],
          commissionRecords: [],
          withdrawals: [],
          summary: {
            attributedOrders: 8,
            refundedOrders: 2,
            pendingWithdrawals: 1,
          },
        }}
      />
    );

    expect(screen.getByText("分销中心")).toBeInTheDocument();
    expect(screen.getAllByText("北区代理")).toHaveLength(2);
    expect(screen.getByText("TRIP-AGENT")).toBeInTheDocument();
    expect(screen.getByText("归因订单")).toBeInTheDocument();
  });

  it("submits withdrawal form", async () => {
    const { container } = render(
      <DistributionDashboardView
        data={{
          profile: null,
          balance: {
            currency: "USD",
            totalEarned: 8000,
            availableAmount: 5000,
            frozenAmount: 1000,
            withdrawnAmount: 2000,
            reversedAmount: 0,
          },
          referralCodes: [],
          orders: [],
          commissionRecords: [],
          withdrawals: [],
          summary: {
            attributedOrders: 0,
            refundedOrders: 0,
            pendingWithdrawals: 0,
          },
        }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "提现" }));
    fireEvent.click(screen.getByRole("tab", { name: "提现" }));

    await waitFor(() => {
      expect(container.querySelectorAll('input[type="number"]')).toHaveLength(2);
    });

    const numberInputs = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numberInputs[0]!, {
      target: { value: "3000" },
    });
    fireEvent.change(numberInputs[1]!, {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByPlaceholderText("bank_transfer / alipay / wechat"), {
      target: { value: "alipay" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入收款人姓名"), {
      target: { value: "张三" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入银行卡或钱包账号"), {
      target: { value: "zhangsan@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("可填写打款说明或渠道备注"), {
      target: { value: "测试打款" },
    });

    fireEvent.click(screen.getByRole("button", { name: "提交提现申请" }));

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith({
        amount: 3000,
        feeAmount: 100,
        channel: "alipay",
        accountName: "张三",
        accountNo: "zhangsan@example.com",
        note: "测试打款",
      });
    });
  });
});
