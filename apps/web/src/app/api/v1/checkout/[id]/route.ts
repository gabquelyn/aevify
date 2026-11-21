import { NextResponse } from "next/server";
import { apiError, handle } from "@/lib/http";
import { findMerchantById } from "@/lib/merchants";
import { findPayment, serializeCheckout, syncPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/checkout/:id: public, no key needed.
 * Everything needed to pay: shown by the hosted checkout page and used by AI agents paying
 * in code. Contains no secrets; payment IDs are unguessable.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, context: Context) => {
  const { id } = await context.params;
  const payment = await findPayment(id);
  if (!payment) return apiError(404, "not_found", "No payment with that ID.", "id", CORS);
  const merchant = await findMerchantById(payment.merchantId);
  if (!merchant) return apiError(404, "not_found", "No payment with that ID.", "id", CORS);
  const synced = await syncPayment(payment);
  return NextResponse.json(await serializeCheckout(synced, merchant), { headers: CORS });
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
