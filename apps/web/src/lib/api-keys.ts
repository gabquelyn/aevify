import { COLLECTIONS, getDb } from "./db";
import { hashSecret, newId, newSecret } from "./ids";
import { findMerchantById, type MerchantDoc } from "./merchants";

/**
 * API keys, Stripe-style:
 *  - secret keys (sk_test_…) authenticate server-to-server calls. Stored only as hashes,
 *    shown once at creation.
 *  - publishable keys (pk_test_…) are public and identify the merchant in the browser.
 */

export type ApiKeyKind = "secret" | "publishable";

export type ApiKeyDoc = {
  _id: string;
  merchantId: string;
  kind: ApiKeyKind;
  /** SHA-256 of a secret key. */
  hash: string | null;
  /** Publishable keys are public, so they're stored as-is. */
  token: string | null;
  /** Safe to display: "sk_test_…a1B2". */
  preview: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export const MAX_ACTIVE_SECRET_KEYS = 5;

export function apiKeysCollection() {
  return getDb().collection<ApiKeyDoc>(COLLECTIONS.apiKeys);
}

let indexes: Promise<unknown> | undefined;
function ensureIndexes() {
  indexes ??= Promise.all([
    apiKeysCollection().createIndex({ hash: 1 }, { unique: true, partialFilterExpression: { hash: { $type: "string" } } }),
    apiKeysCollection().createIndex({ token: 1 }, { unique: true, partialFilterExpression: { token: { $type: "string" } } }),
    apiKeysCollection().createIndex({ merchantId: 1, createdAt: -1 }),
  ]).catch((error) => {
    indexes = undefined;
    throw error;
  });
  return indexes;
}

const preview = (key: string) => `${key.slice(0, 8)}…${key.slice(-4)}`;

/** Create a key. The plaintext is returned once and never stored (for secret keys). */
export async function createApiKey(merchantId: string, kind: ApiKeyKind) {
  await ensureIndexes();
  const plaintext = kind === "secret" ? newSecret.secretKey() : newSecret.publishableKey();
  const doc: ApiKeyDoc = {
    _id: newId.apiKey(),
    merchantId,
    kind,
    hash: kind === "secret" ? hashSecret(plaintext) : null,
    token: kind === "publishable" ? plaintext : null,
    preview: preview(plaintext),
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await apiKeysCollection().insertOne(doc);
  return { doc, plaintext };
}

export async function countActiveKeys(merchantId: string, kind: ApiKeyKind) {
  return apiKeysCollection().countDocuments({ merchantId, kind, revokedAt: null });
}

export async function listApiKeys(merchantId: string) {
  return apiKeysCollection().find({ merchantId }).sort({ createdAt: -1 }).limit(100).toArray();
}

export async function revokeApiKey(merchantId: string, keyId: string): Promise<boolean> {
  const result = await apiKeysCollection().updateOne(
    { _id: keyId, merchantId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}

/** Is this an active publishable key belonging to the merchant? */
export async function isMerchantPublishableKey(merchantId: string, key: string): Promise<boolean> {
  if (!/^pk_test_[0-9A-Za-z]{32}$/.test(key)) return false;
  const found = await apiKeysCollection().findOne({ token: key, kind: "publishable", revokedAt: null });
  return found?.merchantId === merchantId;
}

/** The merchant for a secret key, or null if the key is unknown or revoked. */
export async function authenticateSecretKey(plaintext: string): Promise<MerchantDoc | null> {
  if (!/^sk_test_[0-9A-Za-z]{40}$/.test(plaintext)) return null;
  const key = await apiKeysCollection().findOne({ hash: hashSecret(plaintext), kind: "secret", revokedAt: null });
  if (!key) return null;
  // Record usage at most once a minute per key.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    void apiKeysCollection()
      .updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return findMerchantById(key.merchantId);
}

export function serializeApiKey(doc: ApiKeyDoc, plaintext?: string) {
  return {
    id: doc._id,
    object: "api_key",
    kind: doc.kind,
    // Publishable keys are always shown in full; secret keys only at creation.
    key: plaintext ?? doc.token ?? null,
    preview: doc.preview,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
    revokedAt: doc.revokedAt?.toISOString() ?? null,
  };
}
