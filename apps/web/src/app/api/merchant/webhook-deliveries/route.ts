import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { handle } from "@/lib/http";
import { listDeliveries, serializeDelivery } from "@/lib/webhook-deliveries";

export const dynamic = "force-dynamic";

/** GET /api/merchant/webhook-deliveries?limit=20: recent webhook events and their delivery status. */
export const GET = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 20, 1), 100);
  const data = await listDeliveries(auth.merchant._id, limit);
  return NextResponse.json({ data: data.map(serializeDelivery) });
});
