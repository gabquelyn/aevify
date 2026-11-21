import { NextResponse } from "next/server";
import { requireSecretKey } from "@/lib/api-auth";
import { apiError, handle } from "@/lib/http";
import { findPayment, serializePayment, syncPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/payments/:id: one payment, refreshed from the chain. */
export const GET = handle(async (request: Request, context: Context) => {
  const auth = await requireSecretKey(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const payment = await findPayment(id, auth._id);
  if (!payment) return apiError(404, "not_found", "No payment with that ID.", "id");
  return NextResponse.json(serializePayment(await syncPayment(payment)));
});
