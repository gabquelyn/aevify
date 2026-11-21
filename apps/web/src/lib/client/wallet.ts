"use client";

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  numberToHex,
  type Address,
  type Chain,
  type EIP1193Provider,
} from "viem";

/**
 * Browser wallet helpers built on viem, no wallet SDK needed:
 *  - finds installed wallets (EIP-6963, falling back to window.ethereum)
 *  - connects, then switches to Aevum (adding the network if the wallet doesn't know it)
 *  - turns wallet and contract errors into plain sentences
 */

export type PublicChain = {
  id: number;
  name: string;
  rpcUrl: string | null;
  explorerUrl: string | null;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucetUrl?: string | null;
};

export type WalletInfo = { id: string; name: string; icon: string | null; provider: EIP1193Provider };

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

type AnnounceEvent = CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider }>;

/** Installed browser wallets. Resolves after a short wait for EIP-6963 announcements. */
export function discoverWallets(waitMs = 250): Promise<WalletInfo[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve([]);
    const found = new Map<string, WalletInfo>();
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as AnnounceEvent).detail;
      found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (found.size === 0 && window.ethereum) {
        found.set("injected", { id: "injected", name: "Browser wallet", icon: null, provider: window.ethereum });
      }
      resolve([...found.values()]);
    }, waitMs);
  });
}

export function toViemChain(chain: PublicChain): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: chain.rpcUrl ? [chain.rpcUrl] : [] } },
    blockExplorers: chain.explorerUrl ? { default: { name: "Explorer", url: chain.explorerUrl } } : undefined,
  });
}

/** Ask the wallet for an account. */
export async function connect(provider: EIP1193Provider): Promise<Address> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("No account was selected in your wallet.");
  return getAddress(accounts[0]);
}

export async function currentChainId(provider: EIP1193Provider): Promise<number> {
  return Number(await provider.request({ method: "eth_chainId" }));
}

/** Make sure the wallet is on the given chain, adding it first if the wallet doesn't know it. */
export async function ensureChain(provider: EIP1193Provider, chain: PublicChain): Promise<void> {
  if ((await currentChainId(provider)) === chain.id) return;
  const chainId = numberToHex(chain.id);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    const code = (error as { code?: number; data?: { originalError?: { code?: number } } })?.code;
    const nested = (error as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
    if (code !== 4902 && nested !== 4902) throw error;
    if (!chain.rpcUrl) throw new Error(`Add the ${chain.name} network to your wallet, then try again.`);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : undefined,
        },
      ],
    });
  }
  if ((await currentChainId(provider)) !== chain.id) {
    throw new Error(`Switch your wallet to ${chain.name} to continue.`);
  }
}

/** viem clients that talk through the wallet (no separate RPC, so no CORS issues). */
export function walletClients(provider: EIP1193Provider, chain: PublicChain, account: Address) {
  const viemChain = toViemChain(chain);
  const transport = custom(provider);
  return {
    publicClient: createPublicClient({ chain: viemChain, transport }),
    walletClient: createWalletClient({ account, chain: viemChain, transport }),
  };
}

const CONTRACT_ERRORS: Record<string, string> = {
  RequestExpired: "This payment request has expired. Ask the store for a new one.",
  AlreadyPaid: "This payment has already been paid.",
  PayerMismatch: "This payment can only be paid by a specific wallet.",
  InvalidSignature: "This payment request isn't valid. Ask the store for a new one.",
  UnknownMerchant: "This store isn't registered on Aevum yet.",
  EnforcedPause: "Payments are temporarily paused. Please try again later.",
  InvalidAmount: "That amount isn't valid.",
  Unauthorized: "This wallet isn't allowed to do that.",
  UnknownPayment: "That payment wasn't found on-chain.",
  NoPendingPayoutChange: "There's no pending payout change.",
  PayoutChangeNotReady: "The payout change isn't ready yet.",
  ERC20InsufficientBalance: "Not enough tUSD8 in this wallet.",
  ERC20InsufficientAllowance: "The token approval is too low. Please approve again.",
};

/** A short, human sentence for any wallet, network or contract error. */
export function friendlyError(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return "You cancelled the request in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Check your wallet.";

  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
      if (reverted.reason) return reverted.reason;
    }
    if (error.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError")) {
      return "You cancelled the request in your wallet.";
    }
    const text = `${error.shortMessage} ${error.details ?? ""}`;
    if (/insufficient funds/i.test(text)) return "Not enough tQDAY in this wallet to pay the network fee (gas).";
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isMobileBrowser(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Opens the current page inside MetaMask Mobile's built-in browser. */
export function metamaskDeepLink(url: string): string {
  return `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`;
}
