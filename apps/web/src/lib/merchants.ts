import { merchantIdFromSlug } from "@aevify/shared";
import type { Address, Hex } from "viem";
import { isChainConfigured, readMerchantOnChain } from "./chain";
import { COLLECTIONS, getDb } from "./db";
import { newId, newSecret, randomBase62, slugify } from "./ids";

export type OnchainStatus = "not_registered" | "pending" | "registered";

export type MerchantDoc = {
  _id: string;
  userId: string;
  name: string;
  /** Permanent; the on-chain merchant ID is keccak256(slug). */
  slug: string;
  onchainMerchantId: Hex;
  onchainStatus: OnchainStatus;
  payoutAddress: Address | null;
  pendingPayoutAddress: Address | null;
  pendingPayoutEffectiveAt: Date | null;
  lastTxHash: Hex | null;
  payoutChallenge: { address: Address; message: string; expiresAt: Date } | null;
  webhookUrl: string | null;
  webhookSecret: string;
  /** Sites allowed to embed this merchant's checkout (exact origins, e.g. "https://shop.example"). */
  allowedOrigins?: string[];
  createdAt: Date;
  updatedAt: Date;
};

export function merchantsCollection() {
  return getDb().collection<MerchantDoc>(COLLECTIONS.merchants);
}

let indexes: Promise<unknown> | undefined;
export function ensureMerchantIndexes() {
  indexes ??= Promise.all([
    merchantsCollection().createIndex({ userId: 1 }, { unique: true }),
    merchantsCollection().createIndex({ slug: 1 }, { unique: true }),
  ]).catch((error) => {
    indexes = undefined;
    throw error;
  });
  return indexes;
}

export async function findMerchantByUser(userId: string) {
  return merchantsCollection().findOne({ userId });
}

export async function findMerchantById(id: string) {
  return merchantsCollection().findOne({ _id: id });
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

/** Create the merchant for a signed-in user (one per user). */
export async function createMerchant(userId: string, name: string): Promise<MerchantDoc> {
  await ensureMerchantIndexes();
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${slugify(name)}-${randomBase62(5).toLowerCase()}`;
    const now = new Date();
    const doc: MerchantDoc = {
      _id: newId.merchant(),
      userId,
      name,
      slug,
      onchainMerchantId: merchantIdFromSlug(slug),
      onchainStatus: "not_registered",
      payoutAddress: null,
      pendingPayoutAddress: null,
      pendingPayoutEffectiveAt: null,
      lastTxHash: null,
      payoutChallenge: null,
      webhookUrl: null,
      webhookSecret: newSecret.webhookSecret(),
      allowedOrigins: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await merchantsCollection().insertOne(doc);
      return doc;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Same user created one concurrently: return it. Otherwise the slug clashed: retry.
      const existing = await findMerchantByUser(userId);
      if (existing) return existing;
    }
  }
  throw new Error("Couldn't generate a unique merchant slug.");
}

export async function updateMerchant(id: string, patch: Partial<Omit<MerchantDoc, "_id" | "userId" | "slug">>) {
  const set = { ...patch, updatedAt: new Date() };
  await merchantsCollection().updateOne({ _id: id }, { $set: set });
  return findMerchantById(id);
}

/**
 * The contract is the source of truth for payout wallets. Refresh our copy from it.
 * Network errors are ignored: the stored copy is returned unchanged.
 */
export async function syncMerchantFromChain(doc: MerchantDoc): Promise<MerchantDoc> {
  if (!isChainConfigured() || doc.onchainStatus === "not_registered") return doc;
  try {
    const onChain = await readMerchantOnChain(doc.onchainMerchantId);
    const next = {
      onchainStatus: onChain.payout ? ("registered" as const) : doc.onchainStatus,
      payoutAddress: onChain.payout ?? doc.payoutAddress,
      pendingPayoutAddress: onChain.pendingPayout,
      pendingPayoutEffectiveAt: onChain.pendingPayoutAt,
    };
    const changed =
      next.onchainStatus !== doc.onchainStatus ||
      next.payoutAddress !== doc.payoutAddress ||
      next.pendingPayoutAddress !== doc.pendingPayoutAddress ||
      next.pendingPayoutEffectiveAt?.getTime() !== doc.pendingPayoutEffectiveAt?.getTime();
    if (!changed) return doc;
    return (await updateMerchant(doc._id, next)) ?? doc;
  } catch (error) {
    console.warn("[merchants] Couldn't sync from chain:", error);
    return doc;
  }
}

/** Merchant as returned to its own (signed-in) owner. */
export function serializeMerchant(doc: MerchantDoc) {
  return {
    id: doc._id,
    object: "merchant",
    name: doc.name,
    slug: doc.slug,
    onchain: {
      merchantId: doc.onchainMerchantId,
      status: doc.onchainStatus,
      payoutAddress: doc.payoutAddress,
      pendingPayoutAddress: doc.pendingPayoutAddress,
      pendingPayoutEffectiveAt: doc.pendingPayoutEffectiveAt?.toISOString() ?? null,
      lastTxHash: doc.lastTxHash,
    },
    webhookUrl: doc.webhookUrl,
    allowedOrigins: doc.allowedOrigins ?? [],
    webhookSecret: doc.webhookSecret,
    readyForPayments: doc.onchainStatus === "registered" && Boolean(doc.payoutAddress),
    createdAt: doc.createdAt.toISOString(),
  };
}
