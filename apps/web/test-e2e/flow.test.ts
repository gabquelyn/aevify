/**
 * The whole payment flow against the REAL AevifyCheckout contract on a local Hardhat chain.
 * Only MongoDB and the auth session are faked (in memory).
 *
 * Needs a fresh chain with the LocalDemo deployment (mock tUSD8 + checkout, deployer as
 * owner/signer/operator):
 *   docker compose up -d chain
 *   docker compose run --rm contracts npm run deploy:local
 *   docker compose run --rm -w /app/apps/web -e E2E_RPC_URL=http://chain:8545 contracts npm run test:e2e
 */
import { aevumChain } from "@aevify/shared";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { aevifyCheckoutAbi } from "@aevify/shared";
import { bearer, json, jsonRequest, params } from "../test/helpers";

const RPC = process.env.E2E_RPC_URL;
const CHECKOUT = (process.env.E2E_CHECKOUT_ADDRESS ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address;

// Hardhat's well-known development keys (never use these anywhere real).
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner, signer, operator
  payout: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  customer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  agent: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  newPayout: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
} as const;

const state = vi.hoisted(() => ({ user: { id: "user_e2e", email: "e2e@example.com", name: null } }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { FakeDb } = await import("../test/fake-db");
  const db = new FakeDb();
  return { ...actual, getDb: () => db, isDatabaseConfigured: () => true };
});
vi.mock("@/lib/session", () => ({ getSessionUser: async () => state.user }));

describe.skipIf(!RPC)("end to end on a local chain", () => {
  const chain = aevumChain(RPC ?? "http://127.0.0.1:8545", 31337);
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const walletFor = (account: PrivateKeyAccount) => createWalletClient({ account, chain, transport: http(RPC) });
  const accounts = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<
    keyof typeof KEYS,
    PrivateKeyAccount
  >;

  let routes: {
    merchant: typeof import("@/app/api/merchant/route");
    keys: typeof import("@/app/api/merchant/keys/route");
    challenge: typeof import("@/app/api/merchant/payout-wallet/challenge/route");
    payout: typeof import("@/app/api/merchant/payout-wallet/route");
    apply: typeof import("@/app/api/merchant/payout-wallet/apply/route");
    payments: typeof import("@/app/api/v1/payments/route");
    payment: typeof import("@/app/api/v1/payments/[id]/route");
    checkout: typeof import("@/app/api/v1/checkout/[id]/route");
    health: typeof import("@/app/api/health/route");
  };
  let token: Address;
  let secretKey: string;

  beforeAll(async () => {
    process.env.AEVUM_RPC_URL = RPC;
    process.env.AEVUM_CHAIN_ID = "31337";
    process.env.AEVIFY_CHECKOUT_ADDRESS = CHECKOUT;
    process.env.AEVIFY_SIGNER_PRIVATE_KEY = KEYS.deployer;
    process.env.AEVIFY_OPERATOR_PRIVATE_KEY = KEYS.deployer;
    routes = {
      merchant: await import("@/app/api/merchant/route"),
      keys: await import("@/app/api/merchant/keys/route"),
      challenge: await import("@/app/api/merchant/payout-wallet/challenge/route"),
      payout: await import("@/app/api/merchant/payout-wallet/route"),
      apply: await import("@/app/api/merchant/payout-wallet/apply/route"),
      payments: await import("@/app/api/v1/payments/route"),
      payment: await import("@/app/api/v1/payments/[id]/route"),
      checkout: await import("@/app/api/v1/checkout/[id]/route"),
      health: await import("@/app/api/health/route"),
    };
    token = await publicClient.readContract({ address: CHECKOUT, abi: aevifyCheckoutAbi, functionName: "token" });
    // Fund the customer, agent and payout wallet (the payout wallet needs tokens to refund).
    const mintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
    for (const who of [accounts.customer, accounts.agent, accounts.payout]) {
      const hash = await walletFor(accounts.deployer).writeContract({ address: token, abi: mintAbi, functionName: "mint", args: [who.address, parseUnits("100", 6)] });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  });

  const balance = (who: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

  async function connect(account: PrivateKeyAccount) {
    const challenge = await json(routes.challenge.POST(jsonRequest("/x", { body: { address: account.address } })));
    const signature = await account.signMessage({ message: challenge.body.message });
    return json(routes.payout.POST(jsonRequest("/x", { body: { address: account.address, signature } })));
  }

  /** Pay a payment exactly as the hosted checkout or an AI agent would: from /api/v1/checkout/:id. */
  async function payFromCheckout(paymentId: string, payer: PrivateKeyAccount) {
    const { body } = await json(routes.checkout.GET(jsonRequest("/x"), params({ id: paymentId })));
    const { approve, args } = body.contractCall;
    const wallet = walletFor(payer);
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: approve.token, abi: erc20Abi, functionName: "approve", args: [approve.spender, BigInt(approve.amount)] }),
    });
    const request = { ...args.request, amount: BigInt(args.request.amount), expiresAt: BigInt(args.request.expiresAt) };
    const hash = await wallet.writeContract({ address: body.contractCall.address, abi: aevifyCheckoutAbi, functionName: "pay", args: [request, args.signature] });
    return { hash, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
  }

  const create = (body: Record<string, unknown>) => json(routes.payments.POST(jsonRequest("/x", { body, headers: bearer(secretKey) })));
  const get = (id: string) => json(routes.payment.GET(jsonRequest("/x", { headers: bearer(secretKey) }), params({ id })));

  it("health check confirms the API's keys match the contract's roles", async () => {
    const res = await json(routes.health.GET());
    expect(res.body).toMatchObject({ status: "ok", chain: { signer: "ok", operator: "ok" } });
  });

  it("registers the merchant's payout wallet on-chain", async () => {
    expect((await json(routes.merchant.POST(jsonRequest("/x", { body: { name: "E2E Store" } })))).status).toBe(201);
    const res = await connect(accounts.payout);
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
    expect(res.body.merchant.onchain).toMatchObject({ status: "registered", payoutAddress: accounts.payout.address });

    const onChain = await publicClient.readContract({
      address: CHECKOUT,
      abi: aevifyCheckoutAbi,
      functionName: "getMerchant",
      args: [res.body.merchant.onchain.merchantId as Hex],
    });
    expect(onChain.payout).toBe(accounts.payout.address);

    secretKey = (await json(routes.keys.POST(jsonRequest("/x", { body: { kind: "secret" } })))).body.key.key;
  });

  it("takes a payment: API request -> customer pays on-chain -> API shows it paid", async () => {
    const created = await create({ amount: "12.50", orderId: "e2e-1" });
    expect(created.status).toBe(201);

    const payoutBefore = await balance(accounts.payout.address);
    const { hash, receipt } = await payFromCheckout(created.body.id, accounts.customer);
    expect(receipt.status).toBe("success");
    expect(await balance(accounts.payout.address)).toBe(payoutBefore + parseUnits("12.125", 6)); // 97%

    const paid = await get(created.body.id);
    expect(paid.body).toMatchObject({ status: "paid", fee: "0.375", paidBy: accounts.customer.address, txHash: hash });
  });

  it("can't be paid twice", async () => {
    const created = await create({ amount: "1" });
    await payFromCheckout(created.body.id, accounts.customer);
    await expect(payFromCheckout(created.body.id, accounts.customer)).rejects.toThrow(/AlreadyPaid/);
  });

  it("reflects a full refund from the merchant's wallet", async () => {
    const created = await create({ amount: "4" });
    await payFromCheckout(created.body.id, accounts.customer);
    const onchainId = (await json(routes.checkout.GET(jsonRequest("/x"), params({ id: created.body.id })))).body.contractCall.args.request.paymentId;

    const merchantWallet = walletFor(accounts.payout);
    await publicClient.waitForTransactionReceipt({
      hash: await merchantWallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [CHECKOUT, parseUnits("4", 6)] }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await merchantWallet.writeContract({ address: CHECKOUT, abi: aevifyCheckoutAbi, functionName: "refund", args: [onchainId, parseUnits("4", 6)] }),
    });

    expect((await get(created.body.id)).body).toMatchObject({ status: "refunded", refunded: "4.00" });
  });

  it("lets only the designated agent pay an agent-locked payment", async () => {
    const created = await create({ amount: "2", payer: accounts.agent.address });
    await expect(payFromCheckout(created.body.id, accounts.customer)).rejects.toThrow(/PayerMismatch/);
    const { receipt } = await payFromCheckout(created.body.id, accounts.agent);
    expect(receipt.status).toBe("success");
    expect((await get(created.body.id)).body).toMatchObject({ status: "paid", paidBy: accounts.agent.address });
  });

  it("rejects payment after the request expires", async () => {
    const created = await create({ amount: "1", expiresInSeconds: 60 });
    await publicClient.request({ method: "evm_increaseTime" as never, params: [120] as never });
    await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    await expect(payFromCheckout(created.body.id, accounts.customer)).rejects.toThrow(/RequestExpired/);
  });

  it("after the contract is redeployed, merchants are registered again automatically", async () => {
    // Deploy a second checkout contract (as a redeploy would) and point the app at it.
    const artifact = JSON.parse(
      readFileSync(new URL("../../../packages/contracts/artifacts/contracts/AevifyCheckout.sol/AevifyCheckout.json", import.meta.url), "utf8"),
    ) as { abi: Abi; bytecode: Hex };
    const deployer = walletFor(accounts.deployer);
    const d = accounts.deployer.address;
    const deployHash = await deployer.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token, d, d, d, d, 300] });
    const newCheckout = (await publicClient.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;
    process.env.AEVIFY_CHECKOUT_ADDRESS = newCheckout;

    const merchant = await json(routes.merchant.GET(jsonRequest("/x")));
    const merchantId = merchant.body.merchant.onchain.merchantId as Hex;
    const onChain = await publicClient.readContract({ address: newCheckout, abi: aevifyCheckoutAbi, functionName: "getMerchant", args: [merchantId] });
    expect(onChain.payout).toBe(accounts.payout.address); // the verified payout wallet, carried over
    expect(merchant.body.merchant.onchain.status).toBe("registered");

    // And it takes payments on the new contract.
    const created = await create({ amount: "2.00", orderId: "after-redeploy" });
    expect(created.status).toBe(201);
    const { receipt } = await payFromCheckout(created.body.id, accounts.customer);
    expect(receipt.status).toBe("success");
    expect(receipt.to?.toLowerCase()).toBe(newCheckout.toLowerCase());
    expect((await get(created.body.id)).body.status).toBe("paid");
  });

  it("changes the payout wallet only after 24 hours", async () => {
    const res = await connect(accounts.newPayout);
    expect(res.body.merchant.onchain).toMatchObject({ payoutAddress: accounts.payout.address, pendingPayoutAddress: accounts.newPayout.address });
    expect((await routes.apply.POST(jsonRequest("/x", { body: {} }))).status).toBe(409);

    await publicClient.request({ method: "evm_increaseTime" as never, params: [24 * 60 * 60 + 60] as never });
    await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    const applied = await json(routes.apply.POST(jsonRequest("/x", { body: {} })));
    expect(applied.status).toBe(200);
    expect(applied.body.merchant.onchain).toMatchObject({ payoutAddress: accounts.newPayout.address, pendingPayoutAddress: null });
  });

});
