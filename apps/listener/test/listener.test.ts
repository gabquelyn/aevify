import { signWebhookPayload, verifyWebhook, WebhookSignatureError, type PaymentDoc, type WebhookDeliveryDoc } from "@aevify/shared";
import { MemoryDb } from "@aevify/shared/testing";
import type { Db } from "mongodb";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { createListener } from "../src/listener.ts";
import { isPrivateAddress, sendWebhook } from "../src/webhook-sender.ts";

const CHECKOUT = "0x00000000000000000000000000000000000000C0" as Address;
const PAYER = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;
const SECRET = "whsec_testsecret0000000000000000000000000000";
const pid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** A fake chain: a list of logs, a block height and on-chain payment records. */
function fakeChain() {
  const chain = {
    height: 100n,
    logs: [] as Array<{ eventName: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: Hex }>,
    paid: new Map<Hex, bigint>(),
    calls: [] as Array<{ fromBlock: bigint; toBlock: bigint }>,
    client: {
      getBlockNumber: async (_opts?: unknown) => chain.height,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_800_000_000n + blockNumber }),
      getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        chain.calls.push({ fromBlock, toBlock });
        return chain.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
      readContract: async ({ args }: { args: [Hex] }) => ({ paidAt: chain.paid.get(args[0]) ?? 0n }),
    },
  };
  return chain;
}

function payment(n: number, over: Partial<PaymentDoc> = {}): PaymentDoc {
  const now = new Date();
  return {
    _id: `pay_test${String(n).padStart(20, "0")}`,
    merchantId: "merch_1",
    onchainPaymentId: pid(n),
    onchainMerchantId: pid(999),
    amount: "10000000",
    decimals: 6,
    currency: "tUSD8",
    orderId: null,
    description: null,
    metadata: {},
    payer: null,
    status: "created",
    expiresAt: new Date(now.getTime() + 900_000),
    signature: "0x",
    successUrl: null,
    cancelUrl: null,
    idempotencyKey: null,
    requestHash: "x",
    createdBlock: "90",
    paidBy: null,
    paidAt: null,
    fee: null,
    refunded: "0",
    txHash: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

type Received = { headers: Headers; body: string };

let db: MemoryDb;
let chain: ReturnType<typeof fakeChain>;
let clock: Date;
let received: Received[];
let respond: () => number;

function makeListener(over: Partial<Parameters<typeof createListener>[0]> = {}) {
  return createListener({
    db: db as unknown as Db,
    publicClient: chain.client as never,
    checkoutAddress: CHECKOUT,
    chainId: 44005,
    appUrl: "https://aevify.test",
    confirmations: 2,
    batchBlocks: 50,
    startBlock: 80n,
    allowPrivateWebhookUrls: true,
    now: () => clock,
    log: () => undefined,
    fetchImpl: (async (_url: URL, init: RequestInit) => {
      received.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: respond() });
    }) as never,
    ...over,
  });
}

const deliveries = () => db.collection("webhook_deliveries").docs as unknown as WebhookDeliveryDoc[];
const payments = () => db.collection("payments").docs as unknown as PaymentDoc[];

beforeEach(async () => {
  db = new MemoryDb();
  chain = fakeChain();
  clock = new Date("2026-11-22T10:00:00Z");
  received = [];
  respond = () => 200;
  await db.collection("merchants").insertOne({ _id: "merch_1", webhookUrl: "https://store.example/hook", webhookSecret: SECRET });
  await makeListener().ensureIndexes();
});

describe("scanning the chain", () => {
  it("marks a payment paid, queues payment.paid, and doesn't repeat it", async () => {
    await db.collection("payments").insertOne(payment(1));
    chain.logs.push({ eventName: "PaymentPaid", args: { paymentId: pid(1), payer: PAYER, fee: 300_000n }, blockNumber: 95n, logIndex: 0, transactionHash: `0x${"ab".repeat(32)}` });
    const listener = makeListener();

    expect(await listener.catchUp()).toBe(1);
    expect(payments()[0]).toMatchObject({ status: "paid", paidBy: PAYER, fee: "300000", txHash: `0x${"ab".repeat(32)}` });
    expect(payments()[0]!.paidAt).toEqual(new Date((1_800_000_000 + 95) * 1000));
    expect(deliveries()).toEqual([expect.objectContaining({ type: "payment.paid", status: "pending", eventKey: `payment.paid:${payments()[0]!._id}` })]);

    // A re-scan of the same blocks (e.g. after a crash) doesn't duplicate the webhook.
    await db.collection("listener_state").updateOne({}, { $set: { lastBlock: "79" } });
    await listener.catchUp();
    expect(deliveries()).toHaveLength(1);
  });

  it("only reads confirmed blocks, in bounded batches, and remembers where it got to", async () => {
    chain.height = 200n;
    const listener = makeListener();
    await listener.catchUp();
    // From startBlock 80 up to 198 (200 - 2 confirmations), 50 blocks at a time.
    expect(chain.calls).toEqual([
      { fromBlock: 80n, toBlock: 129n },
      { fromBlock: 130n, toBlock: 179n },
      { fromBlock: 180n, toBlock: 198n },
    ]);
    expect(await listener.scanOnce()).toBeNull();
    expect((await listener.status()).lastBlock).toBe("198");
  });

  it("tracks partial and full refunds as separate events", async () => {
    await db.collection("payments").insertOne(payment(2, { status: "paid", paidAt: new Date(), fee: "300000" }));
    chain.logs.push(
      { eventName: "PaymentRefunded", args: { paymentId: pid(2), amount: 4_000_000n, totalRefunded: 4_000_000n }, blockNumber: 90n, logIndex: 0, transactionHash: "0x01" },
      { eventName: "PaymentRefunded", args: { paymentId: pid(2), amount: 6_000_000n, totalRefunded: 10_000_000n }, blockNumber: 91n, logIndex: 0, transactionHash: "0x02" },
    );
    await makeListener().catchUp();
    expect(payments()[0]).toMatchObject({ status: "refunded", refunded: "10000000" });
    expect(deliveries().map((d) => d.eventKey)).toEqual([`payment.refunded:${payments()[0]!._id}:4000000`, `payment.refunded:${payments()[0]!._id}:10000000`]);
    const last = JSON.parse(deliveries()[1]!.payload);
    expect(last.data.object).toMatchObject({ status: "refunded", refunded: "10.00" });
  });

  it("ignores contract events for payments Aevify didn't create", async () => {
    chain.logs.push({ eventName: "PaymentPaid", args: { paymentId: pid(77), payer: PAYER, fee: 1n }, blockNumber: 85n, logIndex: 0, transactionHash: "0x03" });
    await makeListener().catchUp();
    expect(deliveries()).toHaveLength(0);
  });
});

describe("expiry", () => {
  it("expires unpaid payments after the grace period, but not paid ones", async () => {
    await db.collection("payments").insertOne(payment(3, { expiresAt: new Date(clock.getTime() - 120_000) }));
    await db.collection("payments").insertOne(payment(4, { expiresAt: new Date(clock.getTime() - 120_000) }));
    await db.collection("payments").insertOne(payment(5, { expiresAt: new Date(clock.getTime() - 10_000) })); // within grace
    chain.paid.set(pid(4), 1n); // paid on-chain just in time
    expect(await makeListener().sweepExpired()).toBe(1);
    expect(payments().map((p) => p.status)).toEqual(["expired", "created", "created"]);
    expect(deliveries()).toEqual([expect.objectContaining({ type: "payment.expired" })]);
  });
});

describe("webhook delivery", () => {
  async function queuePaid() {
    await db.collection("payments").insertOne(payment(6));
    chain.logs.push({ eventName: "PaymentPaid", args: { paymentId: pid(6), payer: PAYER, fee: 300_000n }, blockNumber: 95n, logIndex: 0, transactionHash: "0x04" });
    await makeListener().catchUp();
  }

  it("sends a signed event the merchant can verify", async () => {
    await queuePaid();
    expect(await makeListener().deliverDue()).toBe(1);
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(headers.get("aevify-event-id")).toBe(deliveries()[0]!._id);
    const event = await verifyWebhook(body, headers.get("aevify-signature"), SECRET, { now: Math.floor(Date.now() / 1000) });
    expect(event).toMatchObject({ type: "payment.paid", data: { object: { status: "paid", paidBy: PAYER, checkoutUrl: expect.stringContaining("https://aevify.test/pay/") } } });
    expect(deliveries()[0]).toMatchObject({ status: "succeeded", attempts: 1, lastStatusCode: 200 });
  });

  it("retries failures with backoff, then gives up", async () => {
    await queuePaid();
    respond = () => 500;
    const listener = makeListener();
    await listener.deliverDue();
    expect(deliveries()[0]).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 500 });
    expect(deliveries()[0]!.nextAttemptAt.getTime() - clock.getTime()).toBe(30_000);

    expect(await listener.deliverDue()).toBe(0); // not due yet
    for (let i = 0; i < 10; i++) {
      clock = new Date(clock.getTime() + 13 * 3_600_000);
      await listener.deliverDue();
    }
    expect(deliveries()[0]).toMatchObject({ status: "failed", attempts: 8 });
    expect(received).toHaveLength(8);
  });

  it("recovers after the endpoint comes back", async () => {
    await queuePaid();
    let calls = 0;
    respond = () => (++calls === 1 ? 503 : 204);
    const listener = makeListener();
    await listener.deliverDue();
    clock = new Date(clock.getTime() + 31_000);
    await listener.deliverDue();
    expect(deliveries()[0]).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("parks events when the merchant has no webhook URL", async () => {
    await db.collection("merchants").updateOne({ _id: "merch_1" }, { $set: { webhookUrl: null } });
    await queuePaid();
    expect(deliveries()[0]!.status).toBe("no_endpoint");
    expect(await makeListener().deliverDue()).toBe(0);
  });

  it("releases deliveries left half-sent by a crashed instance", async () => {
    await queuePaid();
    await db.collection("webhook_deliveries").updateOne({}, { $set: { status: "sending", lockedUntil: new Date(clock.getTime() - 1) } });
    expect(await makeListener().deliverDue()).toBe(1);
    expect(deliveries()[0]!.status).toBe("succeeded");
  });
});

describe("webhook signatures", () => {
  it("round-trips and rejects tampering, wrong secrets and replays", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment.paid" });
    const header = await signWebhookPayload(body, SECRET, 1_800_000_000);
    await expect(verifyWebhook(body, header, SECRET, { now: 1_800_000_010 })).resolves.toMatchObject({ id: "evt_1" });
    await expect(verifyWebhook(body + " ", header, SECRET, { now: 1_800_000_010 })).rejects.toThrow(WebhookSignatureError);
    await expect(verifyWebhook(body, header, `${SECRET}x`, { now: 1_800_000_010 })).rejects.toThrow(/doesn't match/);
    await expect(verifyWebhook(body, header, SECRET, { now: 1_800_000_400 })).rejects.toThrow(/tolerance/);
    await expect(verifyWebhook(body, "garbage", SECRET)).rejects.toThrow(/Malformed/);
    await expect(verifyWebhook(body, null, SECRET)).rejects.toThrow(/Missing/);
  });
});

describe("SSRF protection", () => {
  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses private and non-https URLs in production mode", async () => {
    const send = (url: string) =>
      sendWebhook({ url, payload: "{}", secret: SECRET, eventId: "evt", eventType: "webhook.test", timeoutMs: 1000, allowPrivateUrls: false, fetchImpl: (async () => new Response(null)) as never });
    expect((await send("https://127.0.0.1/hook")).error).toMatch(/private/);
    expect((await send("https://169.254.169.254/latest/meta-data")).error).toMatch(/private/);
    expect((await send("https://localhost/hook")).error).toMatch(/private/);
    expect((await send("http://example.com/hook")).error).toMatch(/https/);
  });
});
