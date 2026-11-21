/**
 * The listener against the REAL AevifyCheckout contract on a local Hardhat chain, delivering
 * webhooks to a real local HTTP server. Needs the LocalDemo deployment:
 *   docker compose up -d chain
 *   docker compose run --rm contracts npm run deploy:local
 *   docker compose run --rm -w /app/apps/listener -e E2E_RPC_URL=http://chain:8545 contracts npm run test:e2e
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  aevifyCheckoutAbi,
  aevumChain,
  merchantIdFromSlug,
  paymentIdToBytes32,
  paymentRequestTypedData,
  verifyWebhook,
  type PaymentDoc,
  type WebhookEvent,
} from "@aevify/shared";
import { MemoryDb } from "@aevify/shared/testing";
import type { Db } from "mongodb";
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits, zeroAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createListener } from "../src/listener.ts";

const RPC = process.env.E2E_RPC_URL;
const CHECKOUT = (process.env.E2E_CHECKOUT_ADDRESS ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address;
const SECRET = "whsec_e2e000000000000000000000000000000000000";

describe.skipIf(!RPC)("listener on a local chain", () => {
  const chain = aevumChain(RPC ?? "http://127.0.0.1:8545", 31337);
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"); // signer
  const payout = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // LocalDemo's demo-store payout (#1)
  const customer = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
  const wallet = (account: typeof deployer) => createWalletClient({ account, chain, transport: http(RPC) });

  const db = new MemoryDb();
  const received: Array<{ signature: string | undefined; body: string }> = [];
  let server: Server;
  let token: Address;
  let listener: ReturnType<typeof createListener>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ signature: req.headers["aevify-signature"] as string | undefined, body });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

    await db.collection("merchants").insertOne({ _id: "merch_demo", webhookUrl: url, webhookSecret: SECRET });
    token = await publicClient.readContract({ address: CHECKOUT, abi: aevifyCheckoutAbi, functionName: "token" });
    const mint = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
    for (const to of [customer.address, payout.address]) {
      await publicClient.waitForTransactionReceipt({ hash: await wallet(deployer).writeContract({ address: token, abi: mint, functionName: "mint", args: [to, parseUnits("50", 6)] }) });
    }

    listener = createListener({
      db: db as unknown as Db,
      publicClient: publicClient as never,
      checkoutAddress: CHECKOUT,
      chainId: 31337,
      appUrl: "http://localhost:3000",
      confirmations: 0,
      startBlock: (await publicClient.getBlockNumber()) + 1n,
      allowPrivateWebhookUrls: true,
      log: () => undefined,
    });
    await listener.ensureIndexes();
  });

  afterAll(() => new Promise<void>((r) => server?.close(() => r())));

  /** A payment as the API would create it, signed by the API's signer. */
  async function createPayment(id: string, amount: string): Promise<PaymentDoc> {
    const now = new Date();
    // Use the chain's clock: other e2e suites may have moved it ahead of the wall clock.
    const { timestamp } = await publicClient.getBlock({ blockTag: "latest" });
    const expiresAt = new Date((Number(timestamp) + 15 * 60) * 1000);
    const request = {
      paymentId: paymentIdToBytes32(id),
      merchantId: merchantIdFromSlug("demo-store"),
      amount: parseUnits(amount, 6),
      expiresAt: BigInt(Math.floor(expiresAt.getTime() / 1000)),
      payer: zeroAddress,
    } as const;
    const signature = await deployer.signTypedData(paymentRequestTypedData({ chainId: 31337, checkoutAddress: CHECKOUT, request }));
    const doc: PaymentDoc = {
      _id: id, merchantId: "merch_demo", onchainPaymentId: request.paymentId, onchainMerchantId: request.merchantId,
      amount: request.amount.toString(), decimals: 6, currency: "tUSD8", orderId: null, description: null, metadata: {},
      payer: null, status: "created", expiresAt, signature, successUrl: null, cancelUrl: null, idempotencyKey: null,
      requestHash: "x", createdBlock: null, paidBy: null, paidAt: null, fee: null, refunded: "0", txHash: null, createdAt: now, updatedAt: now,
    };
    await db.collection("payments").insertOne(doc);
    return doc;
  }

  async function pay(doc: PaymentDoc) {
    const w = wallet(customer);
    await publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [CHECKOUT, BigInt(doc.amount)] }) });
    const request = { paymentId: doc.onchainPaymentId, merchantId: doc.onchainMerchantId, amount: BigInt(doc.amount), expiresAt: BigInt(Math.floor(doc.expiresAt.getTime() / 1000)), payer: zeroAddress };
    const hash = await w.writeContract({ address: CHECKOUT, abi: aevifyCheckoutAbi, functionName: "pay", args: [request, doc.signature] });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  const lastEvent = async (): Promise<WebhookEvent> => {
    const r = received.at(-1)!;
    return verifyWebhook(r.body, r.signature, SECRET);
  };

  it("sees a real payment, updates it, and delivers a verifiable payment.paid webhook", async () => {
    const doc = await createPayment("pay_e2elistener000000000001", "8");
    const hash = await pay(doc);
    const result = await listener.tick();
    expect(result).toMatchObject({ events: 1, sent: 1 });

    const stored = (db.collection("payments").docs as unknown as PaymentDoc[]).find((p) => p._id === doc._id)!;
    expect(stored).toMatchObject({ status: "paid", paidBy: customer.address, fee: "240000", txHash: hash });
    const event = await lastEvent();
    expect(event).toMatchObject({ type: "payment.paid", data: { object: { id: doc._id, status: "paid", fee: "0.24", txHash: hash } } });
  });

  it("delivers payment.refunded after the merchant refunds on-chain", async () => {
    const doc = (db.collection("payments").docs as unknown as PaymentDoc[])[0]!;
    const w = wallet(payout);
    await publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [CHECKOUT, parseUnits("8", 6)] }) });
    await publicClient.waitForTransactionReceipt({
      hash: await w.writeContract({ address: CHECKOUT, abi: aevifyCheckoutAbi, functionName: "refund", args: [doc.onchainPaymentId, parseUnits("8", 6)] }),
    });
    expect(await listener.tick()).toMatchObject({ events: 1, sent: 1 });
    expect(await lastEvent()).toMatchObject({ type: "payment.refunded", data: { object: { status: "refunded", refunded: "8.00" } } });
  });

  it("does nothing new on a quiet tick", async () => {
    expect(await listener.tick()).toEqual({ events: 0, expired: 0, sent: 0 });
    expect(received).toHaveLength(2);
  });
});
