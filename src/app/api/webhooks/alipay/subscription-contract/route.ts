import { NextResponse } from "next/server";

import { activateSubscriptionContract } from "@/features/payment/subscription-recurring";
import { withApiLogging } from "@/lib/api-logger";
import { logError } from "@/lib/logger";

/**
 * 支付宝代扣签约回调。
 */
export const POST = withApiLogging(async (request: Request) => {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? ((await request.json()) as Record<string, string>)
      : (Object.fromEntries((await request.formData()).entries()) as Record<
          string,
          string
        >);

    if (!payload.out_agreement_no || payload.status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, error: "签约状态未激活" },
        { status: 400 }
      );
    }

    const contract = await activateSubscriptionContract({
      contractId: payload.out_agreement_no,
      providerContractId:
        payload.agreement_no ?? `alipay_contract_${payload.out_agreement_no}`,
      providerExternalUserId: payload.external_logon_id ?? null,
      rawResponse: payload,
    });

    return NextResponse.json({ success: true, contract });
  } catch (error) {
    logError(error, { source: "alipay-subscription-contract-webhook" });
    return NextResponse.json(
      { success: false, error: "签约回调处理失败" },
      { status: 500 }
    );
  }
});
