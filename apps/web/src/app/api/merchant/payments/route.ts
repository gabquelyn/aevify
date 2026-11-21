import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { handle } from "@/lib/http";
import { listPayments, serializePayment, syncPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** GET /api/merchant/payments?limit=20&startingAfter=pay_...: the dashboard's payment list. */
export const GET = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const startingAfter = url.searchParams.get("startingAfter") ?? undefined;

  const page = await listPayments(auth.merchant._id, { limit, startingAfter });
  // Refresh the ones that may have changed on-chain.
  const data = await Promise.all(
    page.data.map((p) => (p.status === "created" || p.status === "paid" ? syncPayment(p) : p)),
  );
  return NextResponse.json({ data: data.map(serializePayment), hasMore: page.hasMore });
});
