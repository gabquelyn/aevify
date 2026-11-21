import { recordPaymentEvent, TUSD8, type PaymentDoc, type WebhookDeliveryDoc } from "@aevify/shared";
import { COLLECTIONS, getDb } from "./db";
import { env } from "./env";
import { randomBase62 } from "./ids";
import type { MerchantDoc } from "./merchants";
import { ensureDeliveryIndexes } from "./payments";

export function deliveriesCollection() {
  return getDb().collection<WebhookDeliveryDoc>(COLLECTIONS.webhookDeliveries);
}

export async function listDeliveries(merchantId: string, limit: number) {
  return deliveriesCollection().find({ merchantId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

/** Queue a delivery again (fresh retry cycle). */
export async function resendDelivery(merchantId: string, id: string): Promise<boolean> {
  const doc = await deliveriesCollection().findOne({ _id: id, merchantId });
  if (!doc || doc.status === "pending" || doc.status === "sending") return false;
  await deliveriesCollection().updateOne(
    { _id: id, merchantId },
    { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lockedUntil: null } },
  );
  return true;
}

/** A webhook.test event with a sample payment, to check an endpoint end to end. */
export async function queueTestEvent(merchant: MerchantDoc) {
  await ensureDeliveryIndexes();
  const now = new Date();
  const id = `pay_test${randomBase62(20)}`;
  const sample: PaymentDoc = {
    _id: id,
    merchantId: merchant._id,
    onchainPaymentId: `0x${"0".repeat(64)}`,
    onchainMerchantId: merchant.onchainMerchantId,
    amount: "1000000",
    decimals: TUSD8.decimals,
    currency: TUSD8.symbol,
    orderId: "test",
    description: "Test event from the Aevify dashboard",
    metadata: {},
    payer: null,
    status: "paid",
    expiresAt: now,
    signature: "0x",
    successUrl: null,
    cancelUrl: null,
    idempotencyKey: null,
    requestHash: "",
    createdBlock: null,
    paidBy: null,
    paidAt: now,
    fee: "30000",
    refunded: "0",
    txHash: null,
    createdAt: now,
    updatedAt: now,
  };
  await recordPaymentEvent(deliveriesCollection() as never, {
    type: "webhook.test",
    payment: sample,
    webhookUrl: merchant.webhookUrl,
    appUrl: env.appUrl(),
    eventKey: `webhook.test:${randomBase62(16)}`,
  });
}

export function serializeDelivery(d: WebhookDeliveryDoc) {
  return {
    id: d._id,
    object: "webhook_delivery",
    type: d.type,
    paymentId: d.paymentId,
    status: d.status,
    attempts: d.attempts,
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    nextAttemptAt: d.status === "pending" ? d.nextAttemptAt.toISOString() : null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
