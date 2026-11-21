import { isMerchantPublishableKey } from "./api-keys";
import { env } from "./env";
import type { MerchantDoc } from "./merchants";

/**
 * Rules for embedding the hosted checkout in a merchant's site (what @aevify/react does):
 *  1. the iframe URL carries the merchant's publishable key (pk) and the parent page's origin;
 *  2. the key must belong to the payment's merchant;
 *  3. the origin must be in the merchant's allowed domains (localhost is always allowed in
 *     development, so you can try it before configuring anything).
 * The browser enforces the same list through the frame-ancestors header (src/proxy.ts).
 */

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Normalise "https://Shop.example/" to "https://shop.example"; null if it isn't a valid web origin. */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username) return null;
    if (url.protocol === "http:" && !LOCAL_ORIGIN.test(url.origin)) return null; // plain http only for localhost
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedFrameOrigins(merchant: Pick<MerchantDoc, "allowedOrigins">): string[] {
  return merchant.allowedOrigins ?? [];
}

export function isOriginAllowed(merchant: Pick<MerchantDoc, "allowedOrigins">, origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (!env.isProduction() && LOCAL_ORIGIN.test(normalized)) return true;
  return allowedFrameOrigins(merchant).includes(normalized);
}

/** The frame-ancestors sources for an embedded checkout of this merchant. */
export function frameAncestors(merchant: Pick<MerchantDoc, "allowedOrigins">): string {
  const sources = ["'self'", ...allowedFrameOrigins(merchant)];
  if (!env.isProduction()) sources.push("http://localhost:*", "http://127.0.0.1:*");
  return sources.join(" ");
}

export type EmbedCheck = { ok: true; origin: string } | { ok: false; reason: string };

export async function checkEmbed(merchant: MerchantDoc, pk: string | undefined, origin: string | undefined): Promise<EmbedCheck> {
  if (!pk || !(await isMerchantPublishableKey(merchant._id, pk))) {
    return { ok: false, reason: "invalid_publishable_key" };
  }
  if (!origin || !isOriginAllowed(merchant, origin)) {
    return { ok: false, reason: "origin_not_allowed" };
  }
  return { ok: true, origin: normalizeOrigin(origin)! };
}
