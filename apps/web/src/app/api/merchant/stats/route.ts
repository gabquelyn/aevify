import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { handle } from "@/lib/http";
import { paymentStats } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** GET /api/merchant/stats: totals and a 14-day series for the dashboard overview. */
export const GET = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  return NextResponse.json(await paymentStats(auth.merchant._id));
});
