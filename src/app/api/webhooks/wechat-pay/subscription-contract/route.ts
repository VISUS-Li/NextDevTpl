import { NextResponse } from "next/server";

import { activateSubscriptionContract } from "@/features/payment/subscription-recurring";
import { parseWechatRecurringContractNotification } from "@/features/payment/recurring-provider-notify";
import { withApiLogging } from "@/lib/api-logger";
import { logError } from "@/lib/logger";

/**
 * 微信连续扣费签约回调。
 */
export const POST = withApiLogging(async (request: Request) => {
  try {
    const payload = await parseWechatRecurringContractNotification(request);

    if (payload.status !== "active") {
      return NextResponse.json(
        { success: false, error: "签约状态未激活" },
        { status: 400 }
      );
    }

    const contract = await activateSubscriptionContract({
      contractId: payload.contractId,
      providerContractId: payload.providerContractId,
      providerExternalUserId: payload.providerExternalUserId,
      rawResponse: payload.rawResponse,
      ...(payload.nextBillingAt ? { nextBillingAt: payload.nextBillingAt } : {}),
    });

    return NextResponse.json({ success: true, contract });
  } catch (error) {
    logError(error, { source: "wechat-pay-subscription-contract-webhook" });
    return NextResponse.json(
      { success: false, error: "签约回调处理失败" },
      { status: 500 }
    );
  }
});
