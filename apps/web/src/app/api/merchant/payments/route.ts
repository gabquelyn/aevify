import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { apiError, handle, readJson, validationError } from "@/lib/http";
import { syncMerchantFromChain } from "@/lib/merchants";
import {
  createPayment,
  createPaymentSchema,
  listPayments,
  PAYMENT_STATUSES,
  serializePayment,
  syncPayment,
  type PaymentStatus,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

/** GET /api/merchant/payments?limit=20&startingAfter=pay_...&status=paid: the dashboard's payment list. */
export const GET = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const startingAfter = url.searchParams.get("startingAfter") ?? undefined;
  const statusParam = url.searchParams.get("status");
  if (statusParam && !PAYMENT_STATUSES.includes(statusParam as PaymentStatus)) {
    return apiError(400, "invalid_request", `status must be one of: ${PAYMENT_STATUSES.join(", ")}`, "status");
  }

  const page = await listPayments(auth.merchant._id, {
    limit,
    startingAfter,
    status: (statusParam as PaymentStatus) || undefined,
  });
  // Refresh the ones that may have changed on-chain.
  const data = await Promise.all(page.data.map((p) => (p.status === "created" || p.status === "paid" ? syncPayment(p) : p)));
  return NextResponse.json({ data: data.map(serializePayment), hasMore: page.hasMore });
});

/**
 * POST /api/merchant/payments: create a payment link from the dashboard (same fields as
 * POST /api/v1/payments, authenticated by the signed-in session instead of a secret key).
 */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;

  const parsed = createPaymentSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const merchant = await syncMerchantFromChain(auth.merchant);
  if (merchant.onchainStatus !== "registered" || !merchant.payoutAddress) {
    return apiError(409, "merchant_not_ready", "Connect a payout wallet before creating payments.");
  }
  const { payment } = await createPayment(merchant, parsed.data, null);
  return NextResponse.json(serializePayment(payment), { status: 201 });
});
