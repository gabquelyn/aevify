/**
 * Route-level tests for the Aevify API, with MongoDB, the auth session and the chain
 * replaced by in-memory fakes. Payment request signing is real (viem), and checked by
 * recovering the signer from the EIP-712 signature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paymentRequestTypedData, TUSD8 } from "@aevify/shared";
import { recoverTypedDataAddress, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bearer, json, jsonRequest, params } from "./helpers";

// --- Fakes -------------------------------------------------------------------

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string | null },
  merchants: new Map<string, { payout: Address | null; pendingPayout: Address | null; pendingPayoutAt: Date | null }>(),
  payments: new Map<string, { payer: Address; amount: bigint; fee: bigint; refunded: bigint; paidAt: Date }>(),
  signerKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const, // Hardhat account #2
  checkout: "0x00000000000000000000000000000000000000C0" as const,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { FakeDb } = await import("./fake-db");
  const db = new FakeDb();
  return { ...actual, getDb: () => db, isDatabaseConfigured: () => true, __fakeDb: db };
});

vi.mock("@/lib/session", () => ({ getSessionUser: async () => state.user }));

vi.mock("@/lib/chain", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { verifyMessage } = await import("viem");
  const { paymentRequestTypedData, TUSD8 } = await import("@aevify/shared");
  const signer = privateKeyToAccount(state.signerKey);
  const empty = { payout: null, pendingPayout: null, pendingPayoutAt: null };
  return {
    ChainNotConfiguredError: class ChainNotConfiguredError extends Error {},
    isChainConfigured: () => true,
    getChainContext: () => ({ chainId: 44005, checkoutAddress: state.checkout, publicClient: {} }),
    getCheckoutToken: async () => ({ address: TUSD8.address, symbol: TUSD8.symbol, decimals: TUSD8.decimals }),
    signerAddress: () => signer.address,
    signPaymentRequest: (request: never) =>
      signer.signTypedData(paymentRequestTypedData({ chainId: 44005, checkoutAddress: state.checkout, request })),
    readMerchantOnChain: async (id: string) => state.merchants.get(id) ?? empty,
    registerMerchantOnChain: async (id: string, payout: Address) => {
      state.merchants.set(id, { ...empty, payout });
      return { hash: `0x${"11".repeat(32)}`, confirmed: true };
    },
    requestPayoutChangeOnChain: async (id: string, pendingPayout: Address) => {
      const current = state.merchants.get(id) ?? empty;
      state.merchants.set(id, { ...current, pendingPayout, pendingPayoutAt: new Date(Date.now() + 86_400_000) });
      return { hash: `0x${"22".repeat(32)}`, confirmed: true };
    },
    applyPayoutChangeOnChain: async () => ({ hash: `0x${"33".repeat(32)}`, confirmed: true }),
    readPaymentOnChain: async (id: string) => state.payments.get(id) ?? null,
    findPaymentTxHash: async () => `0x${"aa".repeat(32)}`,
    currentBlockNumber: async () => 100n,
    chainTime: async () => new Date(),
    verifyWalletSignature: (address: Address, message: string, signature: Hex) => verifyMessage({ address, message, signature }),
  };
});

// Route handlers (imported after the mocks are registered).
const merchantRoute = await import("@/app/api/merchant/route");
const keysRoute = await import("@/app/api/merchant/keys/route");
const keyRoute = await import("@/app/api/merchant/keys/[id]/route");
const challengeRoute = await import("@/app/api/merchant/payout-wallet/challenge/route");
const payoutRoute = await import("@/app/api/merchant/payout-wallet/route");
const applyRoute = await import("@/app/api/merchant/payout-wallet/apply/route");
const webhookSecretRoute = await import("@/app/api/merchant/webhook-secret/route");
const dashboardPaymentsRoute = await import("@/app/api/merchant/payments/route");
const paymentsRoute = await import("@/app/api/v1/payments/route");
const paymentRoute = await import("@/app/api/v1/payments/[id]/route");
const checkoutRoute = await import("@/app/api/v1/checkout/[id]/route");
const healthRoute = await import("@/app/api/health/route");
const dashboardPaymentRoute = await import("@/app/api/merchant/payments/[id]/route");
const statsRoute = await import("@/app/api/merchant/stats/route");
const configRoute = await import("@/app/api/v1/config/route");
const deliveriesRoute = await import("@/app/api/merchant/webhook-deliveries/route");
const resendRoute = await import("@/app/api/merchant/webhook-deliveries/[id]/resend/route");
const testWebhookRoute = await import("@/app/api/merchant/webhooks/test/route");
const { __fakeDb: fakeDb } = (await import("@/lib/db")) as unknown as { __fakeDb: import("./fake-db").FakeDb };

// --- Helpers -----------------------------------------------------------------

const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // Hardhat #1
const otherWallet = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"); // Hardhat #3
const signer = privateKeyToAccount(state.signerKey);

function signIn(id = "user_1") {
  state.user = { id, email: `${id}@example.com`, name: null };
}

async function createMerchant(name = "Demo Store") {
  return json(await merchantRoute.POST(jsonRequest("/api/merchant", { body: { name } })));
}

async function connectWallet(account = wallet) {
  const challenge = await json(await challengeRoute.POST(jsonRequest("/api/merchant/payout-wallet/challenge", { body: { address: account.address } })));
  const signature = await account.signMessage({ message: challenge.body.message });
  return json(await payoutRoute.POST(jsonRequest("/api/merchant/payout-wallet", { body: { address: account.address, signature } })));
}

async function createSecretKey() {
  const res = await json(await keysRoute.POST(jsonRequest("/api/merchant/keys", { body: { kind: "secret" } })));
  return res.body.key.key as string;
}

/** A signed-in merchant with a connected wallet and a secret key. */
async function readyMerchant(userId = "user_1") {
  signIn(userId);
  const merchant = (await createMerchant(`Store ${userId}`)).body.merchant;
  await connectWallet();
  const secretKey = await createSecretKey();
  return { merchant, secretKey };
}

async function createPayment(secretKey: string, body: Record<string, unknown> = { amount: "25.00", orderId: "1042" }, headers: Record<string, string> = {}) {
  return json(await paymentsRoute.POST(jsonRequest("/api/v1/payments", { body, headers: { ...bearer(secretKey), ...headers } })));
}

beforeEach(() => {
  fakeDb.reset();
  state.user = null;
  state.merchants.clear();
  state.payments.clear();
});

// --- Tests -------------------------------------------------------------------

describe("GET /api/health", () => {
  it("reports a connected database", async () => {
    const res = await json(await healthRoute.GET());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ database: "connected" });
  });
});

describe("merchant profile (dashboard API)", () => {
  it("requires sign-in", async () => {
    const res = await json(await merchantRoute.GET(jsonRequest("/api/merchant")));
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe("authentication_required");
  });

  it("creates one business per user, with a publishable key", async () => {
    signIn();
    expect((await json(await merchantRoute.GET(jsonRequest("/api/merchant")))).body.merchant).toBeNull();

    const created = await createMerchant("Ada's Coffee!");
    expect(created.status).toBe(201);
    expect(created.body.merchant.slug).toMatch(/^adas-coffee-[a-z0-9]{5}$/);
    expect(created.body.merchant.onchain.status).toBe("not_registered");
    expect(created.body.merchant.readyForPayments).toBe(false);
    expect(created.body.merchant.webhookSecret).toMatch(/^whsec_/);

    expect((await createMerchant("Again")).status).toBe(409);

    const keys = await json(await keysRoute.GET(jsonRequest("/api/merchant/keys")));
    expect(keys.body.data).toHaveLength(1);
    expect(keys.body.data[0]).toMatchObject({ kind: "publishable" });
    expect(keys.body.data[0].key).toMatch(/^pk_test_/);
  });

  it("validates the business name", async () => {
    signIn();
    const res = await createMerchant("x");
    expect(res.status).toBe(400);
    expect(res.body.error.param).toBe("name");
  });

  it("only accepts https webhook URLs (http://localhost in development)", async () => {
    signIn();
    await createMerchant();
    const patch = (webhookUrl: string | null) =>
      json(merchantRoute.PATCH ? merchantRoute.PATCH(jsonRequest("/api/merchant", { method: "PATCH", body: { webhookUrl } })) : Promise.reject());
    expect((await patch("http://evil.example.com/hook")).status).toBe(400);
    expect((await patch("https://store.example.com/hook")).body.merchant.webhookUrl).toBe("https://store.example.com/hook");
    expect((await patch("http://localhost:4000/hook")).status).toBe(200);
    expect((await patch(null)).body.merchant.webhookUrl).toBeNull();
  });

  it("rotates the webhook secret", async () => {
    signIn();
    const before = (await createMerchant()).body.merchant.webhookSecret;
    const after = (await json(await webhookSecretRoute.POST(jsonRequest("/api/merchant/webhook-secret", { body: {} })))).body.merchant.webhookSecret;
    expect(after).toMatch(/^whsec_/);
    expect(after).not.toBe(before);
  });
});

describe("payout wallet", () => {
  it("registers the merchant on-chain after the wallet signs the challenge", async () => {
    signIn();
    const { merchant } = (await createMerchant()).body;
    const res = await connectWallet();
    expect(res.status).toBe(200);
    expect(res.body.merchant.onchain).toMatchObject({ status: "registered", payoutAddress: wallet.address });
    expect(res.body.merchant.readyForPayments).toBe(true);
    expect(state.merchants.get(merchant.onchain.merchantId)?.payout).toBe(wallet.address);
  });

  it("rejects a signature from a different wallet", async () => {
    signIn();
    await createMerchant();
    const challenge = await json(await challengeRoute.POST(jsonRequest("/x", { body: { address: wallet.address } })));
    const signature = await otherWallet.signMessage({ message: challenge.body.message });
    const res = await json(await payoutRoute.POST(jsonRequest("/x", { body: { address: wallet.address, signature } })));
    expect(res.status).toBe(400);
    expect(res.body.error.param).toBe("signature");
  });

  it("uses each challenge once", async () => {
    signIn();
    await createMerchant();
    const challenge = await json(await challengeRoute.POST(jsonRequest("/x", { body: { address: wallet.address } })));
    const signature = await wallet.signMessage({ message: challenge.body.message });
    const body = { address: wallet.address, signature };
    expect((await payoutRoute.POST(jsonRequest("/x", { body }))).status).toBe(200);
    expect((await payoutRoute.POST(jsonRequest("/x", { body }))).status).toBe(400);
  });

  it("rejects an expired challenge", async () => {
    signIn();
    await createMerchant();
    const challenge = await json(await challengeRoute.POST(jsonRequest("/x", { body: { address: wallet.address } })));
    const doc = fakeDb.collection("merchants").docs[0] as { payoutChallenge: { expiresAt: Date } };
    doc.payoutChallenge.expiresAt = new Date(Date.now() - 1000);
    const signature = await wallet.signMessage({ message: challenge.body.message });
    const res = await json(await payoutRoute.POST(jsonRequest("/x", { body: { address: wallet.address, signature } })));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/);
  });

  it("delays a payout wallet change by 24 hours", async () => {
    signIn();
    await createMerchant();
    await connectWallet(wallet);
    const res = await connectWallet(otherWallet);
    expect(res.status).toBe(200);
    expect(res.body.notice).toMatch(/24 hours/);
    expect(res.body.merchant.onchain.payoutAddress).toBe(wallet.address); // unchanged for now
    expect(res.body.merchant.onchain.pendingPayoutAddress).toBe(otherWallet.address);

    const apply = await json(await applyRoute.POST(jsonRequest("/x", { body: {} })));
    expect(apply.status).toBe(409);
    expect(apply.body.error.message).toMatch(/after/);
  });
});

describe("API keys", () => {
  it("shows a secret key once, then only a preview", async () => {
    signIn();
    await createMerchant();
    const created = await json(await keysRoute.POST(jsonRequest("/x", { body: { kind: "secret" } })));
    expect(created.status).toBe(201);
    expect(created.body.key.key).toMatch(/^sk_test_[0-9A-Za-z]{40}$/);

    const list = await json(await keysRoute.GET(jsonRequest("/x")));
    const secret = list.body.data.find((k: { kind: string }) => k.kind === "secret");
    expect(secret.key).toBeNull();
    expect(secret.preview).toMatch(/^sk_test_…/);

    // Never stored in plaintext.
    const stored = JSON.stringify(fakeDb.collection("api_keys").docs);
    expect(stored).not.toContain(created.body.key.key);
  });

  it("limits active secret keys", async () => {
    signIn();
    await createMerchant();
    for (let i = 0; i < 5; i++) await createSecretKey();
    expect((await keysRoute.POST(jsonRequest("/x", { body: { kind: "secret" } }))).status).toBe(409);
  });

  it("stops accepting a revoked key", async () => {
    const { secretKey } = await readyMerchant();
    expect((await createPayment(secretKey)).status).toBe(201);

    const keys = await json(await keysRoute.GET(jsonRequest("/x")));
    const id = keys.body.data.find((k: { kind: string }) => k.kind === "secret").id;
    expect((await keyRoute.DELETE(jsonRequest("/x", { method: "DELETE" }), params({ id }))).status).toBe(200);

    expect((await createPayment(secretKey)).status).toBe(401);
  });
});

describe("POST /api/v1/payments", () => {
  it("requires a valid secret key", async () => {
    await readyMerchant();
    expect((await json(await paymentsRoute.POST(jsonRequest("/x", { body: { amount: "1" } })))).status).toBe(401);
    expect((await createPayment(`sk_test_${"x".repeat(40)}`)).status).toBe(401);
    const pk = await createPayment(`pk_test_${"x".repeat(32)}`);
    expect(pk.status).toBe(401);
    expect(pk.body.error.message).toMatch(/publishable/);
  });

  it("refuses until the merchant has a payout wallet", async () => {
    signIn();
    await createMerchant();
    const res = await createPayment(await createSecretKey());
    expect(res.status).toBe(409);
    expect(res.body.error.type).toBe("merchant_not_ready");
  });

  it("creates a payment signed by the Aevify signer", async () => {
    const { merchant, secretKey } = await readyMerchant();
    const res = await createPayment(secretKey, { amount: "25.00", orderId: "1042", description: "Coffee beans", metadata: { cart: "abc" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      object: "payment",
      status: "created",
      amount: "25.00",
      amountBaseUnits: "25000000",
      currency: "tUSD8",
      orderId: "1042",
      metadata: { cart: "abc" },
      livemode: false,
    });
    expect(res.body.id).toMatch(/^pay_[0-9A-Za-z]{24}$/);
    expect(res.body.checkoutUrl).toBe(`http://localhost:3000/pay/${res.body.id}`);
    const expiresIn = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(14 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 60_000);

    // The public checkout data carries a signature that recovers to the signer.
    const checkout = await json(await checkoutRoute.GET(jsonRequest("/x"), params({ id: res.body.id })));
    const { request, signature } = checkout.body.contractCall.args;
    const recovered = await recoverTypedDataAddress({
      ...paymentRequestTypedData({
        chainId: 44005,
        checkoutAddress: state.checkout,
        request: {
          paymentId: request.paymentId,
          merchantId: request.merchantId,
          amount: BigInt(request.amount),
          expiresAt: BigInt(request.expiresAt),
          payer: request.payer,
        },
      }),
      signature,
    });
    expect(recovered).toBe(signer.address);
    expect(request.merchantId).toBe(merchant.onchain.merchantId);
    expect(request.payer).toBe(zeroAddress);
  });

  it("locks a payment to one payer (for AI agents)", async () => {
    const { secretKey } = await readyMerchant();
    const res = await createPayment(secretKey, { amount: "2", payer: otherWallet.address.toLowerCase() });
    expect(res.status).toBe(201);
    expect(res.body.payer).toBe(otherWallet.address); // checksummed
  });

  it.each([
    [{ amount: "0" }, "amount"],
    [{ amount: "-1" }, "amount"],
    [{ amount: "1.1234567" }, "amount"],
    [{ amount: 25 }, "amount"],
    [{ amount: "1000000.000001" }, "amount"],
    [{ amount: "1", expiresInSeconds: 30 }, "expiresInSeconds"],
    [{ amount: "1", payer: "0x123" }, "payer"],
    [{ amount: "1", successUrl: "javascript:alert(1)" }, "successUrl"],
    [{ amount: "1", surprise: true }, undefined],
  ])("rejects invalid input %j", async (body, param) => {
    const { secretKey } = await readyMerchant();
    const res = await createPayment(secretKey, body as Record<string, unknown>);
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe("invalid_request");
    if (param) expect(res.body.error.param).toBe(param);
  });

  it("replays the same payment for a repeated Idempotency-Key", async () => {
    const { secretKey } = await readyMerchant();
    const first = await createPayment(secretKey, { amount: "5" }, { "idempotency-key": "order-7" });
    const second = await createPayment(secretKey, { amount: "5" }, { "idempotency-key": "order-7" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.body.id).toBe(first.body.id);

    const conflict = await createPayment(secretKey, { amount: "6" }, { "idempotency-key": "order-7" });
    expect(conflict.status).toBe(409);
  });
});

describe("reading payments", () => {
  it("keeps merchants' payments private from each other", async () => {
    const a = await readyMerchant("user_a");
    const payment = (await createPayment(a.secretKey)).body;
    const b = await readyMerchant("user_b");
    const res = await json(await paymentRoute.GET(jsonRequest("/x", { headers: bearer(b.secretKey) }), params({ id: payment.id })));
    expect(res.status).toBe(404);
  });

  it("paginates newest first", async () => {
    const { secretKey } = await readyMerchant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await createPayment(secretKey, { amount: `${i + 1}` })).body.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const page1 = await json(await paymentsRoute.GET(jsonRequest("/api/v1/payments?limit=2", { headers: bearer(secretKey) })));
    expect(page1.body.data.map((p: { id: string }) => p.id)).toEqual([ids[2], ids[1]]);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await json(
      await paymentsRoute.GET(jsonRequest(`/api/v1/payments?limit=2&startingAfter=${ids[1]}`, { headers: bearer(secretKey) })),
    );
    expect(page2.body.data.map((p: { id: string }) => p.id)).toEqual([ids[0]]);
    expect(page2.body.hasMore).toBe(false);
  });

  it("picks up payment and refunds from the chain", async () => {
    const { secretKey } = await readyMerchant();
    const created = (await createPayment(secretKey, { amount: "25" })).body;
    const onchainId = (await json(await checkoutRoute.GET(jsonRequest("/x"), params({ id: created.id })))).body.contractCall.args.request.paymentId;
    const get = () => json(paymentRoute.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id: created.id })));

    state.payments.set(onchainId, { payer: otherWallet.address, amount: 25_000_000n, fee: 750_000n, refunded: 0n, paidAt: new Date() });
    const paid = await get();
    expect(paid.body).toMatchObject({ status: "paid", fee: "0.75", paidBy: otherWallet.address, refunded: "0.00" });
    expect(paid.body.txHash).toMatch(/^0x/);

    state.payments.set(onchainId, { payer: otherWallet.address, amount: 25_000_000n, fee: 750_000n, refunded: 10_000_000n, paidAt: new Date() });
    expect((await get()).body).toMatchObject({ status: "paid", refunded: "10.00" });

    state.payments.set(onchainId, { payer: otherWallet.address, amount: 25_000_000n, fee: 750_000n, refunded: 25_000_000n, paidAt: new Date() });
    expect((await get()).body.status).toBe("refunded");
  });

  it("marks unpaid payments expired after their deadline", async () => {
    const { secretKey } = await readyMerchant();
    const created = (await createPayment(secretKey, { amount: "3" })).body;
    const doc = fakeDb.collection("payments").docs[0] as { expiresAt: Date };
    doc.expiresAt = new Date(Date.now() - 1000);
    const res = await json(await paymentRoute.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id: created.id })));
    expect(res.body.status).toBe("expired");
  });

  it("lists payments in the dashboard", async () => {
    const { secretKey } = await readyMerchant();
    await createPayment(secretKey);
    const res = await json(await dashboardPaymentsRoute.GET(jsonRequest("/api/merchant/payments")));
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/v1/checkout/:id (hosted checkout and agents)", () => {
  it("is public, CORS-enabled and contains no merchant secrets", async () => {
    const { secretKey } = await readyMerchant();
    const created = (await createPayment(secretKey, { amount: "25", description: "Beans" })).body;
    state.user = null; // no session, no key

    const res = await json(await checkoutRoute.GET(jsonRequest("/x"), params({ id: created.id })));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.body).toMatchObject({
      object: "checkout",
      status: "created",
      amount: "25.00",
      merchant: { name: "Store user_1", verified: true, payoutAddress: wallet.address },
      chain: { id: 44005 },
      token: { address: TUSD8.address, decimals: 6 },
      contractCall: { address: state.checkout, functionName: "pay", approve: { amount: "25000000" } },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("whsec_");
    expect(text).not.toContain("sk_test_");
    expect(text).not.toContain("webhookSecret");
  });

  it("returns 404 for unknown or malformed IDs", async () => {
    expect((await checkoutRoute.GET(jsonRequest("/x"), params({ id: "pay_doesnotexist000000000000" }))).status).toBe(404);
    expect((await checkoutRoute.GET(jsonRequest("/x"), params({ id: "../../etc" }))).status).toBe(404);
  });
});

describe("dashboard payments, links and stats", () => {
  it("creates a payment link from the dashboard session", async () => {
    await readyMerchant();
    const res = await json(dashboardPaymentsRoute.POST(jsonRequest("/api/merchant/payments", { body: { amount: "7.5", description: "Gift card" } })));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: "7.50", description: "Gift card", status: "created" });
    expect(res.body.onchain.paymentId).toMatch(/^0x[0-9a-f]{64}$/);

    const detail = await json(dashboardPaymentRoute.GET(jsonRequest("/x"), params({ id: res.body.id })));
    expect(detail.body.id).toBe(res.body.id);
  });

  it("refuses payment links until a payout wallet is connected", async () => {
    signIn();
    await createMerchant();
    const res = await json(dashboardPaymentsRoute.POST(jsonRequest("/x", { body: { amount: "1" } })));
    expect(res.status).toBe(409);
  });

  it("filters by status and rejects unknown statuses", async () => {
    const { secretKey } = await readyMerchant();
    const a = (await createPayment(secretKey, { amount: "1" })).body;
    await createPayment(secretKey, { amount: "2" });
    const onchainId = a.onchain.paymentId;
    state.payments.set(onchainId, { payer: otherWallet.address, amount: 1_000_000n, fee: 30_000n, refunded: 0n, paidAt: new Date() });

    const paid = await json(dashboardPaymentsRoute.GET(jsonRequest("/api/merchant/payments?status=paid")));
    // The list refreshes from the chain first, so the newly paid one shows up after a read.
    await json(paymentRoute.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id: a.id })));
    const paidAfter = await json(dashboardPaymentsRoute.GET(jsonRequest("/api/merchant/payments?status=paid")));
    expect(paidAfter.body.data.map((p: { id: string }) => p.id)).toEqual([a.id]);
    expect(paid.status).toBe(200);
    expect((await dashboardPaymentsRoute.GET(jsonRequest("/api/merchant/payments?status=bogus"))).status).toBe(400);
  });

  it("totals volume, fees, refunds and counts", async () => {
    const { secretKey } = await readyMerchant();
    const p1 = (await createPayment(secretKey, { amount: "10" })).body;
    const p2 = (await createPayment(secretKey, { amount: "5" })).body;
    await createPayment(secretKey, { amount: "3" }); // stays unpaid
    state.payments.set(p1.onchain.paymentId, { payer: otherWallet.address, amount: 10_000_000n, fee: 300_000n, refunded: 0n, paidAt: new Date() });
    state.payments.set(p2.onchain.paymentId, { payer: otherWallet.address, amount: 5_000_000n, fee: 150_000n, refunded: 5_000_000n, paidAt: new Date() });
    for (const p of [p1, p2]) await paymentRoute.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id: p.id }));

    const stats = await json(statsRoute.GET(jsonRequest("/api/merchant/stats")));
    expect(stats.body).toMatchObject({
      currency: "tUSD8",
      volume: "15.00",
      fees: "0.45",
      refunded: "5.00",
      net: "9.55",
      counts: { created: 1, paid: 1, refunded: 1, expired: 0 },
    });
    expect(stats.body.daily).toHaveLength(14);
    expect(stats.body.daily.at(-1).volume).toBe("15.00");
  });
});

describe("GET /api/v1/config", () => {
  it("returns public chain, contract and token details", async () => {
    const res = await json(configRoute.GET());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      chain: { id: 44005, name: "QDay Aevum Testnet", explorerUrl: "https://explorer-test.qday.info" },
      checkoutAddress: state.checkout,
      token: { symbol: "tUSD8", decimals: 6 },
    });
  });
});

describe("webhook events", () => {
  const deliveries = () => fakeDb.collection("webhook_deliveries").docs as Array<{ type: string; status: string; eventKey: string; payload: string }>;

  it("records payment.paid once when a read sees the payment on-chain", async () => {
    const { secretKey } = await readyMerchant();
    signIn();
    await json(merchantRoute.PATCH!(jsonRequest("/api/merchant", { method: "PATCH", body: { webhookUrl: "https://store.example.com/hook" } })));
    const p = (await createPayment(secretKey, { amount: "10" })).body;
    state.payments.set(p.onchain.paymentId, { payer: otherWallet.address, amount: 10_000_000n, fee: 300_000n, refunded: 0n, paidAt: new Date() });

    const get = () => paymentRoute.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id: p.id }));
    await get();
    await get();
    const paid = deliveries().filter((d) => d.type === "payment.paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]!.status).toBe("pending");
    const event = JSON.parse(paid[0]!.payload);
    expect(event).toMatchObject({ object: "event", type: "payment.paid", data: { object: { id: p.id, status: "paid", fee: "0.30" } } });

    // A partial refund, then the rest: two refund events.
    state.payments.set(p.onchain.paymentId, { payer: otherWallet.address, amount: 10_000_000n, fee: 300_000n, refunded: 4_000_000n, paidAt: new Date() });
    await get();
    state.payments.set(p.onchain.paymentId, { payer: otherWallet.address, amount: 10_000_000n, fee: 300_000n, refunded: 10_000_000n, paidAt: new Date() });
    await get();
    await get();
    expect(deliveries().filter((d) => d.type === "payment.refunded").map((d) => d.eventKey)).toEqual([
      `payment.refunded:${p.id}:4000000`,
      `payment.refunded:${p.id}:10000000`,
    ]);
  });

  it("records payment.expired, marked no_endpoint when there's no webhook URL", async () => {
    const { secretKey } = await readyMerchant();
    const p = (await createPayment(secretKey, { amount: "2" })).body;
    (fakeDb.collection("payments").docs[0] as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000);
    await paymentRoute.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id: p.id }));
    expect(deliveries()).toEqual([expect.objectContaining({ type: "payment.expired", status: "no_endpoint" })]);
  });
});

describe("webhook deliveries in the dashboard", () => {
  it("queues a test event, lists it, and allows resending once finished", async () => {
    await readyMerchant();
    expect((await testWebhookRoute.POST(jsonRequest("/x", { body: {} }))).status).toBe(409); // no URL yet
    await merchantRoute.PATCH!(jsonRequest("/api/merchant", { method: "PATCH", body: { webhookUrl: "https://store.example.com/hook" } }));
    expect((await testWebhookRoute.POST(jsonRequest("/x", { body: {} }))).status).toBe(202);

    const list = await json(deliveriesRoute.GET(jsonRequest("/api/merchant/webhook-deliveries")));
    expect(list.body.data).toEqual([expect.objectContaining({ type: "webhook.test", status: "pending", attempts: 0 })]);
    const id = list.body.data[0].id;

    expect((await resendRoute.POST(jsonRequest("/x", { body: {} }), params({ id }))).status).toBe(409); // still queued
    const doc = fakeDb.collection("webhook_deliveries").docs[0] as { status: string; attempts: number };
    doc.status = "failed";
    doc.attempts = 8;
    expect((await resendRoute.POST(jsonRequest("/x", { body: {} }), params({ id }))).status).toBe(200);
    expect(doc).toMatchObject({ status: "pending", attempts: 0 });
  });
});

describe("@aevify/node against the real API routes", () => {
  /** Routes SDK requests straight to the route handlers, in-process. */
  const inProcessFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const request = new Request(url, init);
    const path = url.pathname;
    let m: RegExpMatchArray | null;
    if (path === "/api/v1/payments") return request.method === "POST" ? paymentsRoute.POST(request) : paymentsRoute.GET(request);
    if ((m = path.match(/^\/api\/v1\/payments\/([^/]+)$/))) return paymentRoute.GET(request, params({ id: decodeURIComponent(m[1]!) }));
    if ((m = path.match(/^\/api\/v1\/checkout\/([^/]+)$/))) return checkoutRoute.GET(request, params({ id: decodeURIComponent(m[1]!) }));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  it("creates, retrieves, lists and reads checkout data", async () => {
    const { Aevify, InvalidRequestError, AuthenticationError } = await import("../../../packages/node/src/index.ts");
    const { secretKey } = await readyMerchant();
    const aevify = new Aevify(secretKey, { baseUrl: "http://localhost:3000", fetch: inProcessFetch, maxRetries: 0 });

    const created = await aevify.payments.create({ amount: "9.99", orderId: "sdk-1", metadata: { source: "sdk" } }, { idempotencyKey: "sdk-order-1" });
    expect(created).toMatchObject({ object: "payment", amount: "9.99", status: "created", metadata: { source: "sdk" } });
    // Same idempotency key -> same payment.
    expect((await aevify.payments.create({ amount: "9.99", orderId: "sdk-1", metadata: { source: "sdk" } }, { idempotencyKey: "sdk-order-1" })).id).toBe(created.id);

    expect((await aevify.payments.retrieve(created.id)).id).toBe(created.id);
    expect((await aevify.payments.list({ limit: 5 })).data.map((p) => p.id)).toContain(created.id);
    const checkout = await aevify.payments.retrieveCheckout(created.id);
    expect(checkout).toMatchObject({ object: "checkout", amount: "9.99" });

    await expect(aevify.payments.create({ amount: "0" })).rejects.toBeInstanceOf(InvalidRequestError);
    const bad = new Aevify(`sk_test_${"z".repeat(40)}`, { baseUrl: "http://localhost:3000", fetch: inProcessFetch, maxRetries: 0 });
    await expect(bad.payments.list()).rejects.toBeInstanceOf(AuthenticationError);
  });
});

const { checkEmbed, normalizeOrigin } = await import("@/lib/embed");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");
const { findMerchantById } = await import("@/lib/merchants");

describe("publishable key roles: embedding the checkout", () => {
  async function setup() {
    const { merchant, secretKey } = await readyMerchant();
    const keys = await json(keysRoute.GET(jsonRequest("/x")));
    const pk = keys.body.data.find((k: { kind: string }) => k.kind === "publishable").key as string;
    const payment = (await createPayment(secretKey, { amount: "4" })).body;
    return { merchantId: merchant.id as string, pk, payment };
  }
  const patchOrigins = (allowedOrigins: string[]) =>
    json(merchantRoute.PATCH!(jsonRequest("/api/merchant", { method: "PATCH", body: { allowedOrigins } })));

  it("normalises allowed domains and rejects unsafe ones", async () => {
    await setup();
    const ok = await patchOrigins(["https://Shop.Example.com/", "https://shop.example.com", "http://localhost:5173"]);
    expect(ok.body.merchant.allowedOrigins).toEqual(["https://shop.example.com", "http://localhost:5173"]);
    expect((await patchOrigins(["http://shop.example.com"])).status).toBe(400); // http only for localhost
    expect((await patchOrigins(["https://shop.example.com/checkout"])).status).toBe(400); // origin only
    expect((await patchOrigins(["javascript:alert(1)"])).status).toBe(400);
    expect(normalizeOrigin("https://a.b:8443/")).toBe("https://a.b:8443");
  });

  it("requires the store's own publishable key and an allowed origin", async () => {
    const a = await setup();
    const merchant = (await findMerchantById(a.merchantId))!;
    expect(await checkEmbed(merchant, a.pk, "http://localhost:4000")).toEqual({ ok: true, origin: "http://localhost:4000" }); // dev
    expect(await checkEmbed(merchant, a.pk, "https://shop.example.com")).toMatchObject({ ok: false, reason: "origin_not_allowed" });
    await patchOrigins(["https://shop.example.com"]);
    expect(await checkEmbed((await findMerchantById(a.merchantId))!, a.pk, "https://shop.example.com")).toMatchObject({ ok: true });
    expect(await checkEmbed(merchant, undefined, "http://localhost:4000")).toMatchObject({ ok: false, reason: "invalid_publishable_key" });

    // A publishable key from another store is refused.
    signIn("user_other");
    await createMerchant("Other Store");
    const otherKeys = await json(keysRoute.GET(jsonRequest("/x")));
    const otherPk = otherKeys.body.data.find((k: { kind: string }) => k.kind === "publishable").key as string;
    expect(await checkEmbed(merchant, otherPk, "http://localhost:4000")).toMatchObject({ ok: false, reason: "invalid_publishable_key" });
  });

  it("sends frame-ancestors: none everywhere, allowed domains for embedded checkout", async () => {
    const { payment } = await setup();
    await patchOrigins(["https://shop.example.com"]);
    const csp = async (path: string) => (await proxy(new NextRequest(`http://localhost:3000${path}`))).headers.get("content-security-policy");
    expect(await csp("/dashboard")).toBe("frame-ancestors 'none'");
    expect(await csp(`/pay/${payment.id}`)).toBe("frame-ancestors 'none'");
    expect(await csp(`/pay/${payment.id}?embed=1`)).toBe("frame-ancestors 'self' https://shop.example.com http://localhost:* http://127.0.0.1:*");
    expect(await csp("/pay/pay_doesnotexist000000000000?embed=1")).toBe("frame-ancestors 'self'");
  });
});
