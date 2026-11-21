import {
  aevifyCheckoutAbi,
  recordPaymentEvent,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  type PaymentDoc,
  type WebhookDeliveryDoc,
  type WebhookEventType,
} from "@aevify/shared";
import type { Db } from "mongodb";
import type { Address, Hex, PublicClient } from "viem";
import { sendWebhook, type SendResult } from "./webhook-sender.ts";

/**
 * The listener's three jobs, each safe to run repeatedly and to restart at any time:
 *  1. scanOnce: read contract events block by block and update payments
 *  2. sweepExpired: mark unpaid payments expired once they're past their deadline
 *  3. deliverDue: send pending webhooks, with retries
 * Every change records a webhook event with a deterministic key, so nothing is sent twice.
 */

type MerchantLite = { _id: string; webhookUrl: string | null; webhookSecret: string };
type CursorDoc = { _id: string; lastBlock: string; updatedAt: Date };

export type ListenerDeps = {
  db: Db;
  publicClient: Pick<PublicClient, "getBlockNumber" | "getContractEvents" | "getBlock" | "readContract">;
  checkoutAddress: Address;
  chainId: number;
  appUrl: string;
  /** Blocks to wait before trusting an event. */
  confirmations?: number;
  /** Max blocks per getLogs request (RPCs limit ranges). */
  batchBlocks?: number;
  /** Where to start the very first scan (default: 5,000 blocks back). */
  startBlock?: bigint;
  /** Grace period after expiresAt before marking expired (covers in-flight transactions). */
  expiryGraceMs?: number;
  webhookTimeoutMs?: number;
  allowPrivateWebhookUrls?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

export function createListener(deps: ListenerDeps) {
  const confirmations = BigInt(deps.confirmations ?? 1);
  const batchBlocks = BigInt(deps.batchBlocks ?? 2000);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m, e) => console.log(`[listener] ${m}`, e ? JSON.stringify(e) : ""));
  const payments = deps.db.collection<PaymentDoc>("payments");
  const merchants = deps.db.collection<MerchantLite>("merchants");
  const deliveries = deps.db.collection<WebhookDeliveryDoc>("webhook_deliveries");
  const state = deps.db.collection<CursorDoc>("listener_state");
  const cursorId = `checkout:${deps.chainId}:${deps.checkoutAddress.toLowerCase()}`;
  const blockTimes = new Map<bigint, Date>();

  async function ensureIndexes() {
    await Promise.all([
      deliveries.createIndex({ eventKey: 1 }, { unique: true }),
      deliveries.createIndex({ status: 1, nextAttemptAt: 1 }),
      deliveries.createIndex({ merchantId: 1, createdAt: -1 }),
      payments.createIndex({ onchainPaymentId: 1 }, { unique: true }),
      payments.createIndex({ status: 1, expiresAt: 1 }),
    ]);
  }

  async function blockTime(blockNumber: bigint): Promise<Date> {
    const cached = blockTimes.get(blockNumber);
    if (cached) return cached;
    const block = await deps.publicClient.getBlock({ blockNumber });
    const time = new Date(Number(block.timestamp) * 1000);
    if (blockTimes.size > 500) blockTimes.clear();
    blockTimes.set(blockNumber, time);
    return time;
  }

  async function record(type: WebhookEventType, payment: PaymentDoc) {
    const merchant = await merchants.findOne({ _id: payment.merchantId });
    const recorded = await recordPaymentEvent(deliveries as never, { type, payment, webhookUrl: merchant?.webhookUrl ?? null, appUrl: deps.appUrl, now: now() });
    if (recorded) log(`Queued ${type}`, { payment: payment._id });
  }

  async function update(doc: PaymentDoc, set: Partial<PaymentDoc>): Promise<PaymentDoc> {
    const next = { ...doc, ...set, updatedAt: now() };
    await payments.updateOne({ _id: doc._id }, { $set: { ...set, updatedAt: next.updatedAt } });
    return next;
  }

  // --- 1. Chain events -----------------------------------------------------

  async function onPaid(args: { paymentId: Hex; payer: Address; fee: bigint }, txHash: Hex, blockNumber: bigint) {
    const doc = await payments.findOne({ onchainPaymentId: args.paymentId });
    if (!doc) return; // paid outside Aevify's API (e.g. the smoke-test script)
    const paidAt = doc.paidAt ?? (await blockTime(blockNumber));
    const next = await update(doc, {
      // Also corrects a payment a read marked expired by wall-clock time but the chain accepted in time.
      status: doc.status === "refunded" ? "refunded" : "paid",
      paidBy: args.payer,
      paidAt,
      fee: args.fee.toString(),
      txHash,
    });
    await record("payment.paid", next);
  }

  async function onRefunded(args: { paymentId: Hex; totalRefunded: bigint }) {
    const doc = await payments.findOne({ onchainPaymentId: args.paymentId });
    if (!doc) return;
    const refunded = args.totalRefunded.toString();
    const next = await update(doc, { refunded, status: args.totalRefunded >= BigInt(doc.amount) ? "refunded" : "paid" });
    await record("payment.refunded", next);
  }

  /** Process the next batch of confirmed blocks. Returns null when already up to date. */
  async function scanOnce(): Promise<{ from: bigint; to: bigint; events: number } | null> {
    const latest = await deps.publicClient.getBlockNumber({ cacheTime: 0 }); // viem caches this by default
    const safe = latest - confirmations;
    if (safe < 0n) return null;
    const cursor = await state.findOne({ _id: cursorId });
    const from = cursor ? BigInt(cursor.lastBlock) + 1n : (deps.startBlock ?? (safe > 5000n ? safe - 5000n : 0n));
    if (from > safe) return null;
    const to = from + batchBlocks - 1n < safe ? from + batchBlocks - 1n : safe;

    const logs = await deps.publicClient.getContractEvents({ address: deps.checkoutAddress, abi: aevifyCheckoutAbi, fromBlock: from, toBlock: to });
    const ordered = [...logs].sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
    let events = 0;
    for (const entry of ordered) {
      if (entry.eventName === "PaymentPaid") {
        await onPaid(entry.args as { paymentId: Hex; payer: Address; fee: bigint }, entry.transactionHash!, entry.blockNumber!);
        events++;
      } else if (entry.eventName === "PaymentRefunded") {
        await onRefunded(entry.args as { paymentId: Hex; totalRefunded: bigint });
        events++;
      }
    }

    // Save progress only after the whole batch succeeded (a crash re-processes it; events are idempotent).
    if (cursor) await state.updateOne({ _id: cursorId }, { $set: { lastBlock: to.toString(), updatedAt: now() } });
    else await state.insertOne({ _id: cursorId, lastBlock: to.toString(), updatedAt: now() });
    return { from, to, events };
  }

  /** Scan until caught up (bounded, so one tick can't run forever). */
  async function catchUp(maxBatches = 20) {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const result = await scanOnce();
      if (!result) break;
      total += result.events;
    }
    return total;
  }

  // --- 2. Expiry -----------------------------------------------------------

  async function sweepExpired(): Promise<number> {
    const cutoff = new Date(now().getTime() - (deps.expiryGraceMs ?? 60_000));
    const due = await payments.find({ status: "created", expiresAt: { $lt: cutoff } }).sort({ expiresAt: 1 }).limit(100).toArray();
    let expired = 0;
    for (const doc of due) {
      const onChain = await deps.publicClient.readContract({ address: deps.checkoutAddress, abi: aevifyCheckoutAbi, functionName: "getPayment", args: [doc.onchainPaymentId] });
      if (onChain.paidAt > 0n) continue; // paid after all; the scan will record it
      const next = await update(doc, { status: "expired" });
      await record("payment.expired", next);
      expired++;
    }
    return expired;
  }

  // --- 3. Webhook delivery -------------------------------------------------

  async function deliverOne(delivery: WebhookDeliveryDoc): Promise<SendResult | null> {
    const at = now();
    // Claim it, so two listener instances never send the same delivery at once.
    const claim = await deliveries.updateOne(
      { _id: delivery._id, status: "pending" },
      { $set: { status: "sending", lockedUntil: new Date(at.getTime() + 2 * 60_000) } },
    );
    if (claim.modifiedCount !== 1) return null;

    const merchant = await merchants.findOne({ _id: delivery.merchantId });
    if (!merchant?.webhookUrl) {
      await deliveries.updateOne({ _id: delivery._id }, { $set: { status: "no_endpoint", lockedUntil: null } });
      return null;
    }

    const result = await sendWebhook({
      url: merchant.webhookUrl,
      payload: delivery.payload,
      secret: merchant.webhookSecret,
      eventId: delivery._id,
      eventType: delivery.type,
      timeoutMs: deps.webhookTimeoutMs ?? 10_000,
      allowPrivateUrls: deps.allowPrivateWebhookUrls ?? false,
      fetchImpl: deps.fetchImpl,
    });
    const attempts = delivery.attempts + 1;
    const history = [...delivery.history, { at, statusCode: result.statusCode, error: result.error, durationMs: result.durationMs }].slice(-20);
    const finished = now();
    const set: Partial<WebhookDeliveryDoc> = { attempts, history, lastStatusCode: result.statusCode, lastError: result.error, lockedUntil: null };
    if (result.ok) {
      Object.assign(set, { status: "succeeded", deliveredAt: finished });
    } else if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
      Object.assign(set, { status: "failed" });
    } else {
      Object.assign(set, { status: "pending", nextAttemptAt: new Date(finished.getTime() + WEBHOOK_RETRY_DELAYS_MS[attempts - 1]!) });
    }
    await deliveries.updateOne({ _id: delivery._id }, { $set: set });
    log(result.ok ? "Delivered webhook" : "Webhook attempt failed", { event: delivery._id, type: delivery.type, attempt: attempts, status: result.statusCode, error: result.error });
    return result;
  }

  async function deliverDue(limit = 20): Promise<number> {
    const at = now();
    // Release deliveries a crashed instance left half-sent.
    const stale = await deliveries.find({ status: "sending", lockedUntil: { $lt: at } }).limit(50).toArray();
    for (const d of stale) await deliveries.updateOne({ _id: d._id, status: "sending" }, { $set: { status: "pending", lockedUntil: null } });

    const due = await deliveries.find({ status: "pending", nextAttemptAt: { $lte: at } }).sort({ nextAttemptAt: 1 }).limit(limit).toArray();
    const results = await Promise.all(due.map(deliverOne));
    return results.filter(Boolean).length;
  }

  async function tick() {
    const events = await catchUp();
    const expired = await sweepExpired();
    const sent = await deliverDue();
    return { events, expired, sent };
  }

  async function status() {
    const cursor = await state.findOne({ _id: cursorId });
    return { chainId: deps.chainId, checkout: deps.checkoutAddress, lastBlock: cursor?.lastBlock ?? null, updatedAt: cursor?.updatedAt ?? null };
  }

  return { ensureIndexes, scanOnce, catchUp, sweepExpired, deliverDue, tick, status };
}

export type Listener = ReturnType<typeof createListener>;
