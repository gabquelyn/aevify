/**
 * @aevify/node: the Aevify server SDK.
 *
 *   const aevify = new Aevify(process.env.AEVIFY_SECRET_KEY!, { baseUrl: "https://aevify.vercel.app" });
 *   const payment = await aevify.payments.create({ amount: "25.00", orderId: "1042" });
 *   // send the customer to payment.checkoutUrl, or open it with @aevify/react
 *
 *   const event = await aevify.webhooks.constructEvent(rawBody, req.headers["aevify-signature"], process.env.AEVIFY_WEBHOOK_SECRET!);
 *
 * Zero dependencies: uses fetch and Web Crypto (Node 20+, Bun, Deno, edge runtimes).
 */
// Bundled into the published package (relative imports, so types are inlined too).
import type { PaymentObject } from "../../shared/src/records.ts";
import {
  verifyWebhook,
  WebhookSignatureError,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEvent,
  type WebhookEventType,
} from "../../shared/src/webhooks.ts";

export const VERSION = "0.1.0";

// --- Types -------------------------------------------------------------------

export type Payment = PaymentObject;
export type PaymentStatus = Payment["status"];
export type { WebhookEvent, WebhookEventType };

export type CreatePaymentParams = {
  /** Decimal string in tUSD8, up to 6 decimals, e.g. "25.00". */
  amount: string;
  /** Your own reference, up to 128 characters. */
  orderId?: string;
  /** Shown to the customer at checkout, up to 500 characters. */
  description?: string;
  /** 60 to 3600 seconds; default 900 (15 minutes). The contract rejects payment after this. */
  expiresInSeconds?: number;
  /** Only this wallet may pay (for example, a specific AI agent's wallet). */
  payer?: `0x${string}`;
  /** Where the hosted checkout sends the customer after paying (gets ?aevify_payment_id=...). */
  successUrl?: string;
  /** Where "Cancel and return" goes. */
  cancelUrl?: string;
  /** Up to 20 string key/value pairs, returned on the payment and in webhooks. */
  metadata?: Record<string, string>;
};

export type ListPaymentsParams = { limit?: number; startingAfter?: string };
export type PaymentList = { object: "list"; data: Payment[]; hasMore: boolean };

export type RequestOptions = {
  /** Retrying with the same key returns the original payment instead of creating another. Generated if omitted. */
  idempotencyKey?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
};

export type AevifyOptions = {
  /** Your Aevify app's URL, e.g. https://aevify.vercel.app. Defaults to the AEVIFY_BASE_URL environment variable. */
  baseUrl?: string;
  /** Default 30 seconds. */
  timeoutMs?: number;
  /** Retries for network errors, 429 and 5xx (with an idempotency key, so retries are safe). Default 2. */
  maxRetries?: number;
  /** Bring your own fetch (tests, proxies). */
  fetch?: typeof fetch;
  /** Secret keys must never reach browsers. Only set this if you really know why. */
  dangerouslyAllowBrowser?: boolean;
};

// --- Errors --------------------------------------------------------------------

/** Base class for every error from the Aevify API. */
export class AevifyError extends Error {
  constructor(
    message: string,
    /** e.g. "invalid_request", "authentication_required", "merchant_not_ready". */
    readonly type: string,
    /** HTTP status, or null for network errors. */
    readonly status: number | null,
    /** The request field that caused the error, if any. */
    readonly param?: string,
  ) {
    super(message);
    this.name = "AevifyError";
  }
}
export class AuthenticationError extends AevifyError {
  override name = "AuthenticationError";
}
export class InvalidRequestError extends AevifyError {
  override name = "InvalidRequestError";
}
export class NotFoundError extends AevifyError {
  override name = "NotFoundError";
}
export class ConflictError extends AevifyError {
  override name = "ConflictError";
}
/** The merchant hasn't connected a payout wallet yet. */
export class MerchantNotReadyError extends AevifyError {
  override name = "MerchantNotReadyError";
}
export class APIError extends AevifyError {
  override name = "APIError";
}
export class ConnectionError extends AevifyError {
  override name = "ConnectionError";
}
export { WebhookSignatureError };

function errorFor(status: number, body: { error?: { type?: string; message?: string; param?: string } } | null): AevifyError {
  const type = body?.error?.type ?? "api_error";
  const message = body?.error?.message ?? `Aevify API responded ${status}`;
  const param = body?.error?.param;
  if (type === "merchant_not_ready") return new MerchantNotReadyError(message, type, status, param);
  if (status === 401 || status === 403) return new AuthenticationError(message, type, status, param);
  if (status === 400) return new InvalidRequestError(message, type, status, param);
  if (status === 404) return new NotFoundError(message, type, status, param);
  if (status === 409) return new ConflictError(message, type, status, param);
  return new APIError(message, type, status, param);
}

// --- Client --------------------------------------------------------------------

const isBrowser = () => typeof window !== "undefined" && typeof (window as { document?: unknown }).document !== "undefined";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomKey = () => `aevify-node-${globalThis.crypto.randomUUID()}`;

export class Aevify {
  readonly payments: Payments;
  readonly webhooks: Webhooks;
  readonly baseUrl: string;
  /** @internal */ readonly _secretKey: string;
  /** @internal */ readonly _options: Required<Pick<AevifyOptions, "timeoutMs" | "maxRetries">> & { fetch: typeof fetch };

  constructor(secretKey: string, options: AevifyOptions = {}) {
    if (isBrowser() && !options.dangerouslyAllowBrowser) {
      throw new Error("@aevify/node runs on your server only. In the browser, use @aevify/react with your publishable key.");
    }
    if (!secretKey || !secretKey.startsWith("sk_")) {
      throw new Error(
        secretKey?.startsWith("pk_")
          ? "That's a publishable key. @aevify/node needs a secret key (sk_test_...)."
          : "Pass your Aevify secret key (sk_test_...), e.g. new Aevify(process.env.AEVIFY_SECRET_KEY).",
      );
    }
    const envBase = typeof process !== "undefined" ? process.env?.AEVIFY_BASE_URL : undefined;
    const baseUrl = options.baseUrl ?? envBase;
    if (!baseUrl) throw new Error("Set baseUrl (your Aevify app's URL) or the AEVIFY_BASE_URL environment variable.");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this._secretKey = secretKey;
    this._options = { timeoutMs: options.timeoutMs ?? 30_000, maxRetries: options.maxRetries ?? 2, fetch: options.fetch ?? globalThis.fetch.bind(globalThis) };
    this.payments = new Payments(this);
    this.webhooks = new Webhooks();
  }

  /** @internal */
  async _request<T>(method: "GET" | "POST", path: string, opts: { body?: unknown; idempotencyKey?: string; timeoutMs?: number; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", "user-agent": `aevify-node/${VERSION}` };
    if (opts.auth !== false) headers.authorization = `Bearer ${this._secretKey}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    // POSTs are only retried when they carry an idempotency key, so a retry can't double-create.
    const retries = method === "GET" || opts.idempotencyKey ? this._options.maxRetries : 0;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this._options.fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? this._options.timeoutMs),
        });
      } catch (error) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const timedOut = (error as Error)?.name === "TimeoutError";
        throw new ConnectionError(timedOut ? "Request to Aevify timed out." : `Couldn't reach Aevify at ${this.baseUrl}: ${(error as Error)?.message}`, "connection_error", null);
      }
      const body = await res.json().catch(() => null);
      if (res.ok) return body as T;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw errorFor(res.status, body);
    }
  }
}

class Payments {
  constructor(private readonly client: Aevify) {}

  /** Create a payment request. Retries are safe: an idempotency key is always sent. */
  create(params: CreatePaymentParams, options: RequestOptions = {}): Promise<Payment> {
    return this.client._request("POST", "/api/v1/payments", {
      body: params,
      idempotencyKey: options.idempotencyKey ?? randomKey(),
      timeoutMs: options.timeoutMs,
    });
  }

  /** One payment, refreshed from the chain. */
  retrieve(id: string, options: RequestOptions = {}): Promise<Payment> {
    return this.client._request("GET", `/api/v1/payments/${encodeURIComponent(id)}`, { timeoutMs: options.timeoutMs });
  }

  /** Newest first. Use `startingAfter` with the last ID for the next page. */
  list(params: ListPaymentsParams = {}, options: RequestOptions = {}): Promise<PaymentList> {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.startingAfter) qs.set("startingAfter", params.startingAfter);
    const query = qs.toString();
    return this.client._request("GET", `/api/v1/payments${query ? `?${query}` : ""}`, { timeoutMs: options.timeoutMs });
  }

  /** Iterate over every payment, fetching pages as needed. */
  async *listAll(params: Omit<ListPaymentsParams, "startingAfter"> = {}): AsyncGenerator<Payment> {
    let startingAfter: string | undefined;
    for (;;) {
      const page = await this.list({ ...params, startingAfter });
      yield* page.data;
      if (!page.hasMore || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1]!.id;
    }
  }

  /**
   * The public checkout data for a payment: what the hosted checkout shows and what an AI
   * agent needs to pay in code (contract address, approve amount, signed request). No key needed.
   */
  retrieveCheckout(id: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.client._request("GET", `/api/v1/checkout/${encodeURIComponent(id)}`, { auth: false, timeoutMs: options.timeoutMs });
  }
}

class Webhooks {
  /** The header Aevify signs webhooks with. */
  readonly signatureHeader = WEBHOOK_SIGNATURE_HEADER;

  /**
   * Verify a webhook and return the event. Pass the RAW request body (not re-serialised JSON).
   * Throws WebhookSignatureError if the signature is wrong, missing or older than the tolerance.
   */
  async constructEvent(
    rawBody: string | Uint8Array | ArrayBuffer,
    signatureHeader: string | string[] | null | undefined,
    secret: string,
    options: { toleranceSeconds?: number } = {},
  ): Promise<WebhookEvent> {
    const payload = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
    const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    return verifyWebhook(payload, header, secret, options);
  }
}

/** Verify a webhook without creating a client (same as aevify.webhooks.constructEvent). */
export function constructWebhookEvent(
  rawBody: string | Uint8Array | ArrayBuffer,
  signatureHeader: string | string[] | null | undefined,
  secret: string,
  options: { toleranceSeconds?: number } = {},
): Promise<WebhookEvent> {
  return new Webhooks().constructEvent(rawBody, signatureHeader, secret, options);
}

export default Aevify;
