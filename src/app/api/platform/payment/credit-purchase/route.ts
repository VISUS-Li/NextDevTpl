import { NextResponse } from "next/server";
import { z } from "zod";

import { createCreditPurchaseCheckoutIntent } from "@/features/payment/credit-purchase";
import { PaymentProvider } from "@/features/payment/types";
import { auth } from "@/lib/auth";

const createCreditPurchaseSchema = z.object({
  packageId: z.enum(["starter", "standard", "premium"]),
  provider: z.nativeEnum(PaymentProvider),
});

/**
 * 创建积分购买支付意图。
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session?.user) {
    return NextResponse.json(
      {
        success: false,
        error: "未登录",
      },
      { status: 401 }
    );
  }

  const payload = createCreditPurchaseSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数错误",
        details: payload.error.flatten(),
      },
      { status: 400 }
    );
  }

  const requestUrl = new URL(request.url);
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = request.headers.get("host")?.split(",")[0]?.trim() ?? "";
  const baseUrl =
    forwardedProto && (forwardedHost || host)
      ? `${forwardedProto}://${forwardedHost || host}`
      : requestUrl.origin;
  const result = await createCreditPurchaseCheckoutIntent({
    userId: session.user.id,
    provider: payload.data.provider,
    packageId: payload.data.packageId,
    baseUrl,
    userAgent: request.headers.get("user-agent"),
    userIp:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip"),
  });

  return NextResponse.json({
    success: true,
    intent: result.summary,
    redirectUrl: result.redirectUrl,
  });
}
