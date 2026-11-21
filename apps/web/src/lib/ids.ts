import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Random base62 string from a cryptographically secure source (no modulo bias). */
export function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62]; // 248 = 62 * 4, reject the rest
      if (out.length === length) break;
    }
  }
  return out;
}

/** Public object IDs: pay_…, merch_…, key_… */
export const newId = {
  merchant: () => `merch_${randomBase62(20)}`,
  payment: () => `pay_${randomBase62(24)}`, // ~142 bits: unguessable, safe to share in checkout links
  apiKey: () => `key_${randomBase62(20)}`,
};

/** Keys and secrets. Test-mode only for now (Aevum Testnet). */
export const newSecret = {
  secretKey: () => `sk_test_${randomBase62(40)}`,
  publishableKey: () => `pk_test_${randomBase62(32)}`,
  webhookSecret: () => `whsec_${randomBase62(40)}`,
  nonce: () => randomBase62(24),
};

/** Secret keys are stored only as SHA-256 hashes. They're high-entropy, so no salt is needed. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** "My Coffee Shop!" -> "my-coffee-shop" */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "") // "Ada's" -> "adas"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "store";
}
