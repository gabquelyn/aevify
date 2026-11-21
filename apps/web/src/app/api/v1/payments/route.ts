import { NextResponse } from "next/server";
import { requireSecretKey } from "@/lib/api-auth";
import { apiError, handle, readJson, validationError } from "@/lib/http";
import { syncMerchantFromChain } from "@/lib/merchants";
import {
  createPayment,
  createPaymentSchema,
  IdempotencyConflictError,
  listPayments,
  serializePayment,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payments
 * Authorization: Bearer sk_test_...
 * Idempotency-Key: <optional, recommended>
 *
 * { "amount": "25.00", "orderId": "1042", "description": "...", "expiresInSeconds": 900,
 *   "payer": "0x... (optional: only this wallet may pay)", "successUrl": "...", "cancelUrl": "...",
 *   "metadata": { "key": "value" } }
 */
export const POST = handle(async (request: Request) => {
  const auth = await requireSecretKey(request);
  if (auth instanceof Response) return auth;

  const parsed = createPaymentSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 255) {
    return apiError(400, "invalid_request", "Idempotency-Key must be at most 255 characters.");
  }

  const merchant = await syncMerchantFromChain(auth);
  if (merchant.onchainStatus !== "registered" || !merchant.payoutAddress) {
    return apiError(
      409,
      "merchant_not_ready",
      merchant.onchainStatus === "pending"
        ? "Your payout wallet registration is still confirming on Aevum. Try again shortly."
        : "Connect a payout wallet in the dashboard before creating payments.",
    );
  }

  try {
    const { payment, replayed } = await createPayment(merchant, parsed.data, idempotencyKey);
    return NextResponse.json(serializePayment(payment), {
      status: replayed ? 200 : 201,
      headers: replayed ? { "Idempotent-Replayed": "true" } : undefined,
    });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return apiError(409, "conflict", error.message);
    throw error;
  }
});

/** GET /api/v1/payments?limit=20&startingAfter=pay_...: newest first. */
export const GET = handle(async (request: Request) => {
  const auth = await requireSecretKey(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const startingAfter = url.searchParams.get("startingAfter") ?? undefined;
  const page = await listPayments(auth._id, { limit, startingAfter });
  return NextResponse.json({ object: "list", data: page.data.map(serializePayment), hasMore: page.hasMore });
});
