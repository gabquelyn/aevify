import { NextResponse } from "next/server";
import { checkEmbed, normalizeOrigin } from "@/lib/embed";
import { apiError, handle } from "@/lib/http";
import { findMerchantById } from "@/lib/merchants";
import { findPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/checkout/:id/embed?pk=pk_test_...&origin=https://shop.example: public.
 * Can this site embed this payment's checkout? @aevify/react asks before opening the modal, so
 * a misconfigured store gets a clear reason instead of a frame the browser silently blocks.
 * Reveals nothing secret: publishable keys and allowed domains are public by design.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;
  const url = new URL(request.url);
  const pk = url.searchParams.get("pk") ?? undefined;
  const origin = url.searchParams.get("origin") ?? undefined;

  const payment = await findPayment(id);
  const merchant = payment ? await findMerchantById(payment.merchantId) : null;
  if (!payment || !merchant) return apiError(404, "not_found", "No payment with that ID.", "id", CORS);

  const result = await checkEmbed(merchant, pk, origin);
  if (result.ok) return NextResponse.json({ ok: true, origin: result.origin }, { headers: CORS });

  const site = (origin && normalizeOrigin(origin)) ?? origin ?? "this site";
  const message =
    result.reason === "origin_not_allowed"
      ? `${site} isn't in ${merchant.name}'s allowed domains. Add it in the Aevify dashboard under Developers → Allowed domains.`
      : "This publishable key doesn't belong to the store that created this payment.";
  return NextResponse.json({ ok: false, reason: result.reason, message }, { headers: CORS });
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
