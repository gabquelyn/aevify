import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { revokeApiKey } from "@/lib/api-keys";
import { apiError, handle } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** DELETE /api/merchant/keys/:id: revoke a key immediately. */
export const DELETE = handle(async (request: Request, context: Context) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const revoked = await revokeApiKey(auth.merchant._id, id);
  if (!revoked) return apiError(404, "not_found", "No active key with that ID.");
  return NextResponse.json({ id, revoked: true });
});
