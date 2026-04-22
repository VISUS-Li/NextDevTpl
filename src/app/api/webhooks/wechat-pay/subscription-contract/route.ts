import { NextResponse } from "next/server";

import { activateSubscriptionContract } from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { logError } from "@/lib/logger";

/**
 * 微信连续扣费签约回调。
 */
export const POST = withApiLogging(async (request: Request) => {
  try {
    const payload = (await request.json()) as {
      contract_id?: string;
      provider_contract_id?: string;
      contract_status?: string;
      external_user_id?: string;
    };

    if (!payload.contract_id || payload.contract_status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, error: "签约状态未激活" },
        { status: 400 }
      );
    }

    const contract = await activateSubscriptionContract({
      contractId: payload.contract_id,
      providerContractId:
        payload.provider_contract_id || `wx_contract_${payload.contract_id}`,
      providerExternalUserId: payload.external_user_id ?? null,
      rawResponse: payload,
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
