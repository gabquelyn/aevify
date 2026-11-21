import { authenticateSecretKey } from "./api-keys";
import { apiError } from "./http";
import { findMerchantByUser, type MerchantDoc } from "./merchants";
import { getSessionUser, type SessionUser } from "./session";

const WWW_AUTH = { "WWW-Authenticate": 'Bearer realm="aevify"' };

/** Public API: `Authorization: Bearer sk_test_...`. Returns the merchant or an error response. */
export async function requireSecretKey(request: Request): Promise<MerchantDoc | Response> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) {
    return apiError(401, "authentication_required", "Send your secret key as: Authorization: Bearer sk_test_...", undefined, WWW_AUTH);
  }
  if (match[1].startsWith("pk_")) {
    return apiError(401, "authentication_required", "That's a publishable key. Use a secret key (sk_test_...) from your server.", undefined, WWW_AUTH);
  }
  const merchant = await authenticateSecretKey(match[1]);
  if (!merchant) return apiError(401, "authentication_required", "Invalid or revoked API key.", undefined, WWW_AUTH);
  return merchant;
}

/** Dashboard API: a signed-in user. `merchant` is null until they've created one. */
export async function requireSession(
  request: Request,
): Promise<{ user: SessionUser; merchant: MerchantDoc | null } | Response> {
  const user = await getSessionUser(request.headers);
  if (!user) return apiError(401, "authentication_required", "Sign in to continue.");
  return { user, merchant: await findMerchantByUser(user.id) };
}

/** Dashboard API for users who already have a merchant. */
export async function requireSessionMerchant(request: Request): Promise<{ user: SessionUser; merchant: MerchantDoc } | Response> {
  const result = await requireSession(request);
  if (result instanceof Response) return result;
  if (!result.merchant) return apiError(404, "not_found", "Create your business profile first.");
  return { user: result.user, merchant: result.merchant };
}
