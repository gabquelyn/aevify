import {
  aevifyCheckoutAbi,
  aevumChain,
  paymentRequestTypedData,
  type PaymentRequestStruct,
} from "@aevify/shared";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env";

/**
 * Everything the API does on Aevum: reading the checkout contract, signing payment
 * requests (signer key, off-chain only) and registering merchants (operator key, sends
 * transactions).
 */

export class ChainNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`Blockchain isn't configured: set ${missing} (see .env.example).`);
    this.name = "ChainNotConfiguredError";
  }
}

type ChainContext = {
  publicClient: PublicClient;
  chainId: number;
  checkoutAddress: Address;
};

let cached: { key: string; context: ChainContext } | undefined;

export function isChainConfigured(): boolean {
  return Boolean(env.rpcUrl() && env.checkoutAddress());
}

export function getChainContext(): ChainContext {
  const rpcUrl = env.rpcUrl();
  if (!rpcUrl) throw new ChainNotConfiguredError("AEVUM_RPC_URL");
  const checkout = env.checkoutAddress();
  if (!checkout) throw new ChainNotConfiguredError("AEVIFY_CHECKOUT_ADDRESS");
  const chainId = env.chainId();
  const key = `${rpcUrl}|${chainId}|${checkout}`;
  if (cached?.key !== key) {
    const chain = aevumChain(rpcUrl, chainId);
    cached = {
      key,
      context: {
        publicClient: createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient,
        chainId,
        checkoutAddress: getAddress(checkout),
      },
    };
  }
  return cached.context;
}

// --- Token -----------------------------------------------------------------

let tokenCache: { checkout: Address; token: { address: Address; symbol: string; decimals: number } } | undefined;

/** The token the checkout contract accepts (tUSD8 on Aevum), read once from the contract. */
export async function getCheckoutToken() {
  const { publicClient, checkoutAddress } = getChainContext();
  if (tokenCache?.checkout !== checkoutAddress) {
    const address = await publicClient.readContract({ address: checkoutAddress, abi: aevifyCheckoutAbi, functionName: "token" });
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    tokenCache = { checkout: checkoutAddress, token: { address, symbol, decimals } };
  }
  return tokenCache.token;
}

// --- Signing payment requests ------------------------------------------------

function signerAccount() {
  const key = env.signerPrivateKey();
  if (!key) throw new ChainNotConfiguredError("AEVIFY_SIGNER_PRIVATE_KEY");
  return privateKeyToAccount(key as Hex);
}

export function signerAddress(): Address {
  return signerAccount().address;
}

/** Sign a payment request exactly as AevifyCheckout expects (EIP-712). */
export async function signPaymentRequest(request: PaymentRequestStruct): Promise<Hex> {
  const { chainId, checkoutAddress } = getChainContext();
  return signerAccount().signTypedData(paymentRequestTypedData({ chainId, checkoutAddress, request }));
}

// --- Merchants on-chain ------------------------------------------------------

export type OnChainMerchant = {
  payout: Address | null;
  pendingPayout: Address | null;
  pendingPayoutAt: Date | null;
};

export async function readMerchantOnChain(merchantId: Hex): Promise<OnChainMerchant> {
  const { publicClient, checkoutAddress } = getChainContext();
  const m = await publicClient.readContract({
    address: checkoutAddress,
    abi: aevifyCheckoutAbi,
    functionName: "getMerchant",
    args: [merchantId],
  });
  return {
    payout: m.payout === zeroAddress ? null : m.payout,
    pendingPayout: m.pendingPayout === zeroAddress ? null : m.pendingPayout,
    pendingPayoutAt: m.pendingPayoutAt > 0n ? new Date(Number(m.pendingPayoutAt) * 1000) : null,
  };
}

function operatorWallet() {
  const key = env.operatorPrivateKey();
  if (!key) throw new ChainNotConfiguredError("AEVIFY_OPERATOR_PRIVATE_KEY");
  const { publicClient, chainId, checkoutAddress } = getChainContext();
  const rpcUrl = env.rpcUrl()!;
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain: aevumChain(rpcUrl, chainId), transport: http(rpcUrl) });
  return { wallet, account, publicClient, checkoutAddress };
}

export type TxResult = { hash: Hex; confirmed: boolean };

/** Send a transaction from the operator and wait briefly for it to confirm. */
async function sendOperatorTx(
  functionName: "registerMerchant" | "requestPayoutChange" | "applyPayoutChange",
  args: readonly unknown[],
): Promise<TxResult> {
  const { wallet, account, publicClient, checkoutAddress } = operatorWallet();
  const { request } = await publicClient.simulateContract({
    account,
    address: checkoutAddress,
    abi: aevifyCheckoutAbi,
    functionName,
    args: args as never,
  });
  const hash = await wallet.writeContract(request);
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 25_000 });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
    return { hash, confirmed: true };
  } catch (error) {
    if (error instanceof Error && error.name === "WaitForTransactionReceiptTimeoutError") {
      return { hash, confirmed: false }; // still pending; state syncs from the chain on later reads
    }
    throw error;
  }
}

export const registerMerchantOnChain = (merchantId: Hex, payout: Address) =>
  sendOperatorTx("registerMerchant", [merchantId, payout]);

export const requestPayoutChangeOnChain = (merchantId: Hex, newPayout: Address) =>
  sendOperatorTx("requestPayoutChange", [merchantId, newPayout]);

export const applyPayoutChangeOnChain = (merchantId: Hex) => sendOperatorTx("applyPayoutChange", [merchantId]);

// --- Payments on-chain -------------------------------------------------------

export type OnChainPayment = {
  payer: Address;
  amount: bigint;
  fee: bigint;
  refunded: bigint;
  paidAt: Date;
};

/** The payment as recorded by the contract, or null if it hasn't been paid. */
export async function readPaymentOnChain(paymentId: Hex): Promise<OnChainPayment | null> {
  const { publicClient, checkoutAddress } = getChainContext();
  const p = await publicClient.readContract({
    address: checkoutAddress,
    abi: aevifyCheckoutAbi,
    functionName: "getPayment",
    args: [paymentId],
  });
  if (p.paidAt === 0n) return null;
  return { payer: p.payer, amount: p.amount, fee: p.fee, refunded: p.refunded, paidAt: new Date(Number(p.paidAt) * 1000) };
}

/** Find the transaction that paid a payment (best effort; null if the RPC can't search logs). */
export async function findPaymentTxHash(paymentId: Hex, fromBlock: bigint | null): Promise<Hex | null> {
  const { publicClient, checkoutAddress } = getChainContext();
  try {
    const logs = await publicClient.getContractEvents({
      address: checkoutAddress,
      abi: aevifyCheckoutAbi,
      eventName: "PaymentPaid",
      args: { paymentId },
      fromBlock: fromBlock ?? "earliest",
      toBlock: "latest",
    });
    return logs[0]?.transactionHash ?? null;
  } catch {
    return null;
  }
}

/** The chain's current time (latest block timestamp): what the contract checks deadlines against. */
export async function chainTime(): Promise<Date> {
  const block = await getChainContext().publicClient.getBlock();
  return new Date(Number(block.timestamp) * 1000);
}

export async function currentBlockNumber(): Promise<bigint | null> {
  try {
    return await getChainContext().publicClient.getBlockNumber();
  } catch {
    return null;
  }
}

/**
 * Check a wallet-ownership signature. Uses the RPC so smart-contract wallets (ERC-1271)
 * work too, not just regular accounts.
 */
export async function verifyWalletSignature(address: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    return await getChainContext().publicClient.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}
