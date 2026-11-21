import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { handle } from "@/lib/http";
import { newSecret } from "@/lib/ids";
import { serializeMerchant, updateMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

/** POST /api/merchant/webhook-secret: rotate the webhook signing secret. The old one stops working. */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const merchant = await updateMerchant(auth.merchant._id, { webhookSecret: newSecret.webhookSecret() });
  return NextResponse.json({ merchant: serializeMerchant(merchant ?? auth.merchant) });
});
