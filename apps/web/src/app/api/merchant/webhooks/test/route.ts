import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { apiError, handle } from "@/lib/http";
import { queueTestEvent } from "@/lib/webhook-deliveries";

export const dynamic = "force-dynamic";

/** POST /api/merchant/webhooks/test: send a signed webhook.test event to the configured URL. */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  if (!auth.merchant.webhookUrl) return apiError(409, "conflict", "Add a webhook URL first.");
  await queueTestEvent(auth.merchant);
  return NextResponse.json({ queued: true }, { status: 202 });
});
