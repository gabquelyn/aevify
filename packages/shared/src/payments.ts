/**
 * Payment request signing, shared by the Aevify API (which signs), the contract tests
 * and scripts (which check the contract accepts it), and later the SDKs and agents.
 *
 * Must match AevifyCheckout.sol: same EIP-712 domain, type string and field order.
 */
import { defineChain, keccak256, toHex, type Address, type Chain, type Hex } from "viem";
import { AEVUM_TESTNET } from "./constants.ts";

export const CHECKOUT_DOMAIN = { name: "Aevify Checkout", version: "1" } as const;

export const PAYMENT_REQUEST_TYPES = {
  PaymentRequest: [
    { name: "paymentId", type: "bytes32" },
    { name: "merchantId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
    { name: "payer", type: "address" },
  ],
} as const;

/** The struct passed to AevifyCheckout.pay(). */
export type PaymentRequestStruct = {
  paymentId: Hex;
  merchantId: Hex;
  amount: bigint;
  expiresAt: bigint;
  payer: Address;
};

/** EIP-712 typed data for a payment request, ready for viem's signTypedData. */
export function paymentRequestTypedData(params: {
  chainId: number;
  checkoutAddress: Address;
  request: PaymentRequestStruct;
}) {
  return {
    domain: { ...CHECKOUT_DOMAIN, chainId: params.chainId, verifyingContract: params.checkoutAddress },
    types: PAYMENT_REQUEST_TYPES,
    primaryType: "PaymentRequest" as const,
    message: params.request,
  };
}

/** On-chain merchant ID: keccak256 of the merchant's slug (e.g. "demo-store"). */
export function merchantIdFromSlug(slug: string): Hex {
  return keccak256(toHex(slug));
}

/** On-chain payment ID: keccak256 of Aevify's public payment ID (e.g. "pay_..."). */
export function paymentIdToBytes32(paymentId: string): Hex {
  return keccak256(toHex(paymentId));
}

/**
 * The Aevum chain for viem, with the RPC URL supplied at runtime.
 * `chainId` can be overridden (e.g. 31337 for a local Hardhat chain in tests).
 */
export function aevumChain(rpcUrl: string, chainId: number = AEVUM_TESTNET.id): Chain {
  const isAevum = chainId === AEVUM_TESTNET.id;
  return defineChain({
    id: chainId,
    name: isAevum ? AEVUM_TESTNET.name : `Local chain ${chainId}`,
    nativeCurrency: AEVUM_TESTNET.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: isAevum
      ? { default: { name: "Aevum Explorer", url: AEVUM_EXPLORER_URL, apiUrl: `${AEVUM_EXPLORER_URL}/api` } }
      : undefined,
    testnet: true,
  });
}

export const AEVUM_EXPLORER_URL = "https://explorer-test.qday.info";

export function explorerTxUrl(hash: string): string {
  return `${AEVUM_EXPLORER_URL}/tx/${hash}`;
}
