import { describe, expect, it } from "vitest";
import { signWebhookPayload } from "../../shared/src/webhooks.ts";
import {
  Aevify,
  AuthenticationError,
  ConnectionError,
  constructWebhookEvent,
  InvalidRequestError,
  MerchantNotReadyError,
  WebhookSignatureError,
} from "../src/index.ts";

const KEY = `sk_test_${"a".repeat(40)}`;
type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const client = (f: typeof fetch, extra = {}) => new Aevify(KEY, { baseUrl: "https://aevify.test/", fetch: f, maxRetries: 2, ...extra });
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe("constructor", () => {
  it("rejects publishable keys, missing keys and a missing base URL", () => {
    expect(() => new Aevify(`pk_test_${"a".repeat(32)}`, { baseUrl: "https://x" })).toThrow(/publishable/);
    expect(() => new Aevify("", { baseUrl: "https://x" })).toThrow(/secret key/);
    const saved = process.env.AEVIFY_BASE_URL;
    delete process.env.AEVIFY_BASE_URL;
    expect(() => new Aevify(KEY)).toThrow(/baseUrl/);
    process.env.AEVIFY_BASE_URL = "https://from-env.test";
    expect(new Aevify(KEY).baseUrl).toBe("https://from-env.test");
    if (saved === undefined) delete process.env.AEVIFY_BASE_URL;
    else process.env.AEVIFY_BASE_URL = saved;
  });

  it("refuses to run in a browser", () => {
    const g = globalThis as { window?: unknown };
    g.window = { document: {} };
    try {
      expect(() => new Aevify(KEY, { baseUrl: "https://x" })).toThrow(/server only/);
      expect(() => new Aevify(KEY, { baseUrl: "https://x", dangerouslyAllowBrowser: true })).not.toThrow();
    } finally {
      delete g.window;
    }
  });
});

describe("payments", () => {
  it("creates with auth, JSON and an automatic idempotency key", async () => {
    const { fn, calls } = fakeFetch([json(201, { id: "pay_1", object: "payment" })]);
    const payment = await client(fn).payments.create({ amount: "25.00", orderId: "1042" });
    expect(payment.id).toBe("pay_1");
    expect(calls[0]!.url).toBe("https://aevify.test/api/v1/payments");
    expect(header(calls[0]!, "authorization")).toBe(`Bearer ${KEY}`);
    expect(header(calls[0]!, "idempotency-key")).toMatch(/^aevify-node-/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ amount: "25.00", orderId: "1042" });
  });

  it("retries 5xx and network errors with the same idempotency key", async () => {
    const { fn, calls } = fakeFetch([json(503, {}), new TypeError("fetch failed"), json(201, { id: "pay_2" })]);
    await client(fn).payments.create({ amount: "1" }, { idempotencyKey: "order-9" });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => header(c, "idempotency-key"))).toEqual(["order-9", "order-9", "order-9"]);
  });

  it("doesn't retry client errors and maps them to typed errors", async () => {
    const { fn, calls } = fakeFetch([json(400, { error: { type: "invalid_request", message: "amount: bad", param: "amount" } })]);
    const error = await client(fn).payments.create({ amount: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error).toMatchObject({ status: 400, type: "invalid_request", param: "amount" });
    expect(calls).toHaveLength(1);

    const notReady = fakeFetch([json(409, { error: { type: "merchant_not_ready", message: "Connect a wallet" } })]);
    await expect(client(notReady.fn).payments.create({ amount: "1" })).rejects.toBeInstanceOf(MerchantNotReadyError);
    const unauth = fakeFetch([json(401, { error: { type: "authentication_required", message: "Invalid key" } })]);
    await expect(client(unauth.fn).payments.retrieve("pay_x")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("gives up with a ConnectionError", async () => {
    const { fn, calls } = fakeFetch([new TypeError("down"), new TypeError("down"), new TypeError("down")]);
    await expect(client(fn).payments.retrieve("pay_1")).rejects.toBeInstanceOf(ConnectionError);
    expect(calls).toHaveLength(3);
  });

  it("lists and pages through everything", async () => {
    const { fn, calls } = fakeFetch([
      json(200, { object: "list", data: [{ id: "pay_3" }, { id: "pay_2" }], hasMore: true }),
      json(200, { object: "list", data: [{ id: "pay_1" }], hasMore: false }),
    ]);
    const ids: string[] = [];
    for await (const p of client(fn).payments.listAll({ limit: 2 })) ids.push(p.id);
    expect(ids).toEqual(["pay_3", "pay_2", "pay_1"]);
    expect(calls[1]!.url).toBe("https://aevify.test/api/v1/payments?limit=2&startingAfter=pay_2");
  });

  it("fetches public checkout data without the secret key", async () => {
    const { fn, calls } = fakeFetch([json(200, { object: "checkout" })]);
    await client(fn).payments.retrieveCheckout("pay_1");
    expect(header(calls[0]!, "authorization")).toBeNull();
  });
});

describe("webhooks", () => {
  const secret = "whsec_unit000000000000000000000000000000000";
  it("verifies a signed body (string or bytes) and rejects tampering", async () => {
    const body = JSON.stringify({ id: "evt_1", object: "event", type: "payment.paid", data: { object: { id: "pay_1" } } });
    const sig = await signWebhookPayload(body, secret);
    const event = await client(fakeFetch([]).fn).webhooks.constructEvent(body, sig, secret);
    expect(event.type).toBe("payment.paid");
    await expect(constructWebhookEvent(new TextEncoder().encode(body), [sig], secret)).resolves.toMatchObject({ id: "evt_1" });
    await expect(constructWebhookEvent(body.replace("pay_1", "pay_2"), sig, secret)).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});
