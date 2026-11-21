import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { apiError, handle } from "@/lib/http";
import { resendDelivery } from "@/lib/webhook-deliveries";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** POST /api/merchant/webhook-deliveries/:id/resend: queue a delivered, failed or parked event again. */
export const POST = handle(async (request: Request, context: Context) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!(await resendDelivery(auth.merchant._id, id))) {
    return apiError(409, "conflict", "That event is already queued, or doesn't exist.");
  }
  return NextResponse.json({ id, queued: true });
});
