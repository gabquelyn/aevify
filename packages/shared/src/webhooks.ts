/**
 * Aevify webhook signatures. Used by the listener (to sign) and @aevify/node (to verify).
 *
 *   Aevify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 *
 * The HMAC is computed with the merchant's webhook secret (whsec_...) over
 * `${t}.${rawBody}`. Receivers must use the raw request body exactly as received, and
 * reject events whose timestamp is too old (default tolerance: 5 minutes) to stop replays.
 *
 * Uses only Web Crypto, so it runs in Node 20+, edge runtimes, Bun and Deno.
 */
import type { PaymentObject } from "./records.ts";

export const WEBHOOK_SIGNATURE_HEADER = "Aevify-Signature";
export const WEBHOOK_EVENT_ID_HEADER = "Aevify-Event-Id";
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export const WEBHOOK_EVENT_TYPES = ["payment.paid", "payment.refunded", "payment.expired", "webhook.test"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** The JSON body Aevify POSTs to a merchant's webhook URL. */
export type WebhookEvent = {
  id: string;
  object: "event";
  type: WebhookEventType;
  createdAt: string;
  livemode: false;
  data: { object: PaymentObject };
};

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build the Aevify-Signature header value for a payload. */
export async function signWebhookPayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}

/**
 * Verify a webhook and return the parsed event. Throws WebhookSignatureError if the
 * signature is missing, malformed, wrong, or too old.
 */
export async function verifyWebhook(
  payload: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): Promise<WebhookEvent> {
  if (!signatureHeader) throw new WebhookSignatureError(`Missing ${WEBHOOK_SIGNATURE_HEADER} header.`);
  if (!secret?.startsWith("whsec_")) throw new WebhookSignatureError("The webhook secret should start with whsec_.");

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || !Number.isFinite(timestamp) || signatures.length === 0) {
    throw new WebhookSignatureError(`Malformed ${WEBHOOK_SIGNATURE_HEADER} header.`);
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - timestamp) > tolerance) {
    throw new WebhookSignatureError("Webhook timestamp is outside the tolerance window (possible replay).");
  }

  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  if (!signatures.some((s) => constantTimeEqual(s, expected))) {
    throw new WebhookSignatureError("Webhook signature doesn't match. Check you're using the raw body and the right secret.");
  }

  try {
    return JSON.parse(payload) as WebhookEvent;
  } catch {
    throw new WebhookSignatureError("Webhook body isn't valid JSON.");
  }
}
