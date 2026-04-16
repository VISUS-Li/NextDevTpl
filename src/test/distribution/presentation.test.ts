import { describe, expect, it } from "vitest";

import {
  buildReferralLink,
  formatDistributionAmount,
  getAfterSalesLabel,
  getAvailableCommissionRatio,
  getCommissionStatusMeta,
  getWithdrawalStatusMeta,
} from "@/features/distribution/presentation";

describe("distribution presentation helpers", () => {
  it("formats amount with currency", () => {
    expect(formatDistributionAmount(12345, "USD")).toContain("123");
  });

  it("builds referral link with ref query", () => {
    expect(buildReferralLink("agent-01", "/pricing")).toContain("ref=agent-01");
  });

  it("calculates available ratio", () => {
    expect(getAvailableCommissionRatio({ availableAmount: 3000, totalEarned: 12000 })).toBe(25);
  });

  it("returns status labels", () => {
    expect(getCommissionStatusMeta("available").label).toBe("可提现");
    expect(getWithdrawalStatusMeta("pending").label).toBe("待处理");
    expect(getAfterSalesLabel("chargeback")).toBe("拒付");
  });
});
