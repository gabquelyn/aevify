import { createHash } from "node:crypto";
import {
  aevifyCheckoutAbi,
  fromBaseUnits,
  paymentIdToBytes32,
  recordPaymentEvent,
  serializePayment as serializePaymentObject,
  toBaseUnits,
  TUSD8,
  type PaymentDoc,
  type PaymentRequestStruct,
  type PaymentStatus,
  type WebhookEventType,
} from "@aevify/shared";
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  currentBlockNumber,
  findPaymentTxHash,
  getChainContext,
  getCheckoutToken,
  isChainConfigured,
  readPaymentOnChain,
  signPaymentRequest,
} from "./chain";
import { COLLECTIONS, getDb } from "./db";
import { env } from "./env";
import { newId } from "./ids";
import { publicChainConfig } from "./public-config";
import { findMerchantById, type MerchantDoc } from "./merchants";

// --- Types -------------------------------------------------------------------

export type { PaymentDoc, PaymentStatus } from "@aevify/shared";

export function paymentsCollection() {
  return getDb().collection<PaymentDoc>(COLLECTIONS.payments);
}

let indexes: Promise<unknown> | undefined;
function ensureIndexes() {
  indexes ??= Promise.all([
    ensureDeliveryIndexes(),
    paymentsCollection().createIndex({ merchantId: 1, createdAt: -1 }),
    paymentsCollection().createIndex(
      { merchantId: 1, idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
    ),
    paymentsCollection().createIndex({ onchainPaymentId: 1 }, { unique: true }),
    paymentsCollection().createIndex({ status: 1, expiresAt: 1 }),
  ]).catch((error) => {
    indexes = undefined;
    throw error;
  });
  return indexes;
}

/** Indexes for webhook deliveries (also created by the listener). */
export function ensureDeliveryIndexes() {
  const deliveries = getDb().collection(COLLECTIONS.webhookDeliveries);
  return Promise.all([
    deliveries.createIndex({ eventKey: 1 }, { unique: true }),
    deliveries.createIndex({ status: 1, nextAttemptAt: 1 }),
    deliveries.createIndex({ merchantId: 1, createdAt: -1 }),
  ]);
}

// --- Input -------------------------------------------------------------------

const MAX_AMOUNT = 1_000_000n * 10n ** BigInt(TUSD8.decimals);

const urlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//.test(u), "must be an http(s) URL");

export const createPaymentSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,6})?$/, 'must be a decimal string with up to 6 decimal places, e.g. "25.00"')
      .refine((v) => {
        // Zod still runs this when the format check above failed; leave that case to it.
        if (!/^\d+(\.\d{1,6})?$/.test(v)) return true;
        const units = toBaseUnits(v, TUSD8.decimals);
        return units > 0n && units <= MAX_AMOUNT;
      }, "must be greater than 0 and at most 1,000,000"),
    orderId: z.string().trim().min(1).max(128).optional(),
    description: z.string().trim().max(500).optional(),
    expiresInSeconds: z.number().int().min(60).max(3600).default(900),
    payer: z
      .string()
      .refine((v) => isAddress(v), "must be a valid 0x address")
      .transform((v) => getAddress(v))
      .optional(),
    successUrl: urlSchema.optional(),
    cancelUrl: urlSchema.optional(),
    metadata: z
      .record(z.string().max(40), z.string().max(500))
      .refine((m) => Object.keys(m).length <= 20, "at most 20 keys")
      .optional(),
  })
  .strict();

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

// --- Create ------------------------------------------------------------------

export class IdempotencyConflictError extends Error {
  constructor() {
    super("This Idempotency-Key was already used with different parameters.");
    this.name = "IdempotencyConflictError";
  }
}

const canonicalHash = (input: CreatePaymentInput) =>
  createHash("sha256")
    .update(JSON.stringify(input, Object.keys(input).sort()))
    .update(JSON.stringify(input.metadata ?? {}))
    .digest("hex");

/**
 * Create and sign a payment request for a merchant.
 * With an idempotency key, retries return the original payment instead of a new one.
 */
export async function createPayment(
  merchant: MerchantDoc,
  input: CreatePaymentInput,
  idempotencyKey: string | null,
): Promise<{ payment: PaymentDoc; replayed: boolean }> {
  await ensureIndexes();
  const requestHash = canonicalHash(input);

  if (idempotencyKey) {
    const existing = await paymentsCollection().findOne({ merchantId: merchant._id, idempotencyKey });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
      return { payment: existing, replayed: true };
    }
  }

  const id = newId.payment();
  const amount = toBaseUnits(input.amount, TUSD8.decimals);
  const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
  const request: PaymentRequestStruct = {
    paymentId: paymentIdToBytes32(id),
    merchantId: merchant.onchainMerchantId,
    amount,
    expiresAt: BigInt(Math.floor(expiresAt.getTime() / 1000)),
    payer: input.payer ?? zeroAddress,
  };
  const [signature, block] = await Promise.all([signPaymentRequest(request), currentBlockNumber()]);

  const now = new Date();
  const payment: PaymentDoc = {
    _id: id,
    merchantId: merchant._id,
    onchainPaymentId: request.paymentId,
    onchainMerchantId: request.merchantId,
    amount: amount.toString(),
    decimals: TUSD8.decimals,
    currency: TUSD8.symbol,
    orderId: input.orderId ?? null,
    description: input.description ?? null,
    metadata: input.metadata ?? {},
    payer: input.payer ?? null,
    status: "created",
    expiresAt: new Date(Number(request.expiresAt) * 1000),
    signature,
    successUrl: input.successUrl ?? null,
    cancelUrl: input.cancelUrl ?? null,
    idempotencyKey,
    requestHash,
    createdBlock: block?.toString() ?? null,
    paidBy: null,
    paidAt: null,
    fee: null,
    refunded: "0",
    txHash: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await paymentsCollection().insertOne(payment);
  } catch (error) {
    // Two concurrent requests with the same idempotency key: the other one won.
    if ((error as { code?: number })?.code === 11000 && idempotencyKey) {
      const existing = await paymentsCollection().findOne({ merchantId: merchant._id, idempotencyKey });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
        return { payment: existing, replayed: true };
      }
    }
    throw error;
  }
  return { payment, replayed: false };
}

// --- Read --------------------------------------------------------------------

export async function findPayment(id: string, merchantId?: string) {
  if (!/^pay_[0-9A-Za-z]{24}$/.test(id)) return null;
  return paymentsCollection().findOne(merchantId ? { _id: id, merchantId } : { _id: id });
}

export const PAYMENT_STATUSES: PaymentStatus[] = ["created", "paid", "expired", "refunded"];

export async function listPayments(
  merchantId: string,
  opts: { limit: number; startingAfter?: string; status?: PaymentStatus },
) {
  let createdBefore: Date | undefined;
  if (opts.startingAfter) {
    const cursor = await paymentsCollection().findOne({ _id: opts.startingAfter, merchantId });
    createdBefore = cursor?.createdAt;
  }
  const filter: Record<string, unknown> = { merchantId };
  if (createdBefore) filter.createdAt = { $lt: createdBefore };
  if (opts.status) filter.status = opts.status;
  const docs = await paymentsCollection()
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit + 1)
    .toArray();
  return { data: docs.slice(0, opts.limit), hasMore: docs.length > opts.limit };
}

/**
 * Bring a payment up to date with the contract: paid, refunded or expired.
 * The listener does this continuously; this makes reads correct even without it.
 */
export async function syncPayment(doc: PaymentDoc): Promise<PaymentDoc> {
  if (doc.status === "expired" || doc.status === "refunded" || !isChainConfigured()) return doc;

  let onChain: Awaited<ReturnType<typeof readPaymentOnChain>> = null;
  try {
    onChain = await readPaymentOnChain(doc.onchainPaymentId);
  } catch (error) {
    console.warn("[payments] Couldn't read payment from chain:", error);
    return doc;
  }

  const update: Partial<PaymentDoc> = {};
  if (onChain) {
    const refunded = onChain.refunded.toString();
    const status: PaymentStatus = onChain.refunded >= onChain.amount ? "refunded" : "paid";
    if (doc.status !== status) update.status = status;
    if (doc.paidBy !== onChain.payer) update.paidBy = onChain.payer;
    if (!doc.paidAt) update.paidAt = onChain.paidAt;
    if (doc.fee !== onChain.fee.toString()) update.fee = onChain.fee.toString();
    if (doc.refunded !== refunded) update.refunded = refunded;
    if (!doc.txHash) {
      const txHash = await findPaymentTxHash(doc.onchainPaymentId, doc.createdBlock ? BigInt(doc.createdBlock) : null);
      if (txHash) update.txHash = txHash;
    }
  } else if (doc.status === "created" && Date.now() > doc.expiresAt.getTime()) {
    // The contract rejects payments after expiresAt, so this can't be paid any more.
    update.status = "expired";
  }

  if (Object.keys(update).length === 0) return doc;
  update.updatedAt = new Date();
  await paymentsCollection().updateOne({ _id: doc._id }, { $set: update });
  const next = { ...doc, ...update };
  await recordTransitionEvents(doc, next);
  return next;
}

/**
 * Queue webhooks for what changed. The listener records the same events from the chain;
 * event keys make sure each is delivered once, whoever notices first.
 */
async function recordTransitionEvents(before: PaymentDoc, after: PaymentDoc) {
  const types: WebhookEventType[] = [];
  if (!before.paidAt && after.paidAt) types.push("payment.paid");
  if (after.refunded !== before.refunded && after.refunded !== "0") types.push("payment.refunded");
  if (before.status !== "expired" && after.status === "expired") types.push("payment.expired");
  if (types.length === 0) return;
  try {
    const merchant = await findMerchantById(after.merchantId);
    const deliveries = getDb().collection(COLLECTIONS.webhookDeliveries);
    for (const type of types) {
      await recordPaymentEvent(deliveries as never, { type, payment: after, webhookUrl: merchant?.webhookUrl ?? null, appUrl: env.appUrl() });
    }
  } catch (error) {
    console.warn("[payments] Couldn't record webhook events:", error);
  }
}

// --- Output ------------------------------------------------------------------

const iso = (d: Date | null) => d?.toISOString() ?? null;
const display = (units: string | null, decimals: number) =>
  units === null ? null : fromBaseUnits(BigInt(units), decimals);

export function checkoutUrl(paymentId: string) {
  return `${env.appUrl()}/pay/${paymentId}`;
}

/** Payment as returned to the merchant (secret key or dashboard), and inside webhook events. */
export function serializePayment(doc: PaymentDoc) {
  return serializePaymentObject(doc, env.appUrl());
}

export type CheckoutData = Awaited<ReturnType<typeof serializeCheckout>>;

/**
 * Everything a payer needs, with no secrets: used by the hosted checkout page and by
 * AI agents paying in code. The `contractCall` block is ready to pass to
 * AevifyCheckout.pay(request, signature).
 */
export async function serializeCheckout(doc: PaymentDoc, merchant: MerchantDoc) {
  const { checkoutAddress } = getChainContext();
  const token = await getCheckoutToken();
  return {
    id: doc._id,
    object: "checkout",
    status: doc.status,
    merchant: {
      name: merchant.name,
      slug: merchant.slug,
      verified: merchant.onchainStatus === "registered",
      payoutAddress: merchant.payoutAddress,
    },
    amount: display(doc.amount, doc.decimals),
    amountBaseUnits: doc.amount,
    currency: doc.currency,
    description: doc.description,
    orderId: doc.orderId,
    payer: doc.payer,
    expiresAt: iso(doc.expiresAt),
    successUrl: doc.successUrl,
    cancelUrl: doc.cancelUrl,
    txHash: doc.txHash,
    chain: publicChainConfig(),
    token,
    contractCall: {
      address: checkoutAddress,
      functionName: "pay",
      abi: aevifyCheckoutAbi.filter((item) => item.type === "function" && item.name === "pay"),
      approve: { token: token.address, spender: checkoutAddress, amount: doc.amount },
      args: {
        request: {
          paymentId: doc.onchainPaymentId,
          merchantId: doc.onchainMerchantId,
          amount: doc.amount,
          expiresAt: Math.floor(doc.expiresAt.getTime() / 1000).toString(),
          payer: doc.payer ?? zeroAddress,
        },
        signature: doc.signature,
      },
    },
  };
}

// --- Stats -------------------------------------------------------------------

/** Totals for the dashboard overview (from stored statuses; lists and reads keep them fresh). */
export async function paymentStats(merchantId: string, now = new Date()) {
  const docs = await paymentsCollection().find({ merchantId }).sort({ createdAt: -1 }).limit(5000).toArray();
  let volume = 0n;
  let fees = 0n;
  let refunded = 0n;
  const counts: Record<PaymentStatus, number> = { created: 0, paid: 0, expired: 0, refunded: 0 };

  const days = 14;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daily = Array.from({ length: days }, (_, i) => ({
    date: new Date(startOfToday - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    volume: 0n,
    count: 0,
  }));

  for (const doc of docs) {
    const status = doc.status === "created" && doc.expiresAt.getTime() < now.getTime() ? "expired" : doc.status;
    counts[status] += 1;
    if (status !== "paid" && status !== "refunded") continue;
    const amount = BigInt(doc.amount);
    volume += amount;
    fees += BigInt(doc.fee ?? "0");
    refunded += BigInt(doc.refunded);
    const paidDay = (doc.paidAt ?? doc.createdAt).toISOString().slice(0, 10);
    const bucket = daily.find((d) => d.date === paidDay);
    if (bucket) {
      bucket.volume += amount;
      bucket.count += 1;
    }
  }

  const fmt = (v: bigint) => fromBaseUnits(v, TUSD8.decimals);
  return {
    currency: TUSD8.symbol,
    volume: fmt(volume),
    fees: fmt(fees),
    refunded: fmt(refunded),
    net: fmt(volume - fees - refunded),
    counts,
    daily: daily.map((d) => ({ date: d.date, volume: fmt(d.volume), count: d.count })),
  };
}
