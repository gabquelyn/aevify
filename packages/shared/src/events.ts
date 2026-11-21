/**
 * Recording webhook events. Both the web app (when a read notices a change on-chain) and the
 * listener (when it sees contract events) call recordPaymentEvent; each event has a
 * deterministic key, so it's stored and delivered exactly once whoever notices first.
 *
 * Deliveries are sent by the listener (apps/listener).
 */
import { randomBase62Web } from "./random.ts";
import { serializePayment, type PaymentDoc } from "./records.ts";
import type { WebhookEvent, WebhookEventType } from "./webhooks.ts";

export type DeliveryStatus = "pending" | "sending" | "succeeded" | "failed" | "no_endpoint";

export type DeliveryAttempt = { at: Date; statusCode: number | null; error: string | null; durationMs: number };

/** One event for one merchant, plus its delivery state (collection `webhook_deliveries`). */
export type WebhookDeliveryDoc = {
  /** The event ID (evt_...), also sent as the Aevify-Event-Id header. */
  _id: string;
  merchantId: string;
  paymentId: string | null;
  type: WebhookEventType;
  /** Makes recording idempotent, e.g. "payment.paid:pay_123". */
  eventKey: string;
  /** The exact JSON body, frozen when the event happened. */
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  history: DeliveryAttempt[];
  createdAt: Date;
  deliveredAt: Date | null;
};

/** Retry delays after each failed attempt: 30s, 2m, 10m, 1h, 3h, 6h, 12h (about 22 hours in total). */
export const WEBHOOK_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

export function paymentEventKey(type: WebhookEventType, payment: Pick<PaymentDoc, "_id" | "refunded">): string {
  // A payment is paid or expires once, but can be refunded in several parts.
  return type === "payment.refunded" ? `${type}:${payment._id}:${payment.refunded}` : `${type}:${payment._id}`;
}

type InsertOnly = { insertOne(doc: WebhookDeliveryDoc): Promise<unknown> };

export function buildEvent(id: string, type: WebhookEventType, payment: PaymentDoc, appUrl: string, at = new Date()): WebhookEvent {
  return { id, object: "event", type, createdAt: at.toISOString(), livemode: false, data: { object: serializePayment(payment, appUrl) } };
}

/**
 * Store an event for delivery. Safe to call more than once for the same change: duplicates
 * are ignored (returns false).
 */
export async function recordPaymentEvent(
  deliveries: InsertOnly,
  params: { type: WebhookEventType; payment: PaymentDoc; webhookUrl: string | null; appUrl: string; eventKey?: string; now?: Date },
): Promise<boolean> {
  const now = params.now ?? new Date();
  const id = `evt_${randomBase62Web(24)}`;
  const event = buildEvent(id, params.type, params.payment, params.appUrl, now);
  const doc: WebhookDeliveryDoc = {
    _id: id,
    merchantId: params.payment.merchantId,
    paymentId: params.payment._id,
    type: params.type,
    eventKey: params.eventKey ?? paymentEventKey(params.type, params.payment),
    payload: JSON.stringify(event),
    status: params.webhookUrl ? "pending" : "no_endpoint",
    attempts: 0,
    nextAttemptAt: now,
    lockedUntil: null,
    lastStatusCode: null,
    lastError: null,
    history: [],
    createdAt: now,
    deliveredAt: null,
  };
  try {
    await deliveries.insertOne(doc);
    return true;
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) return false; // already recorded
    throw error;
  }
}
