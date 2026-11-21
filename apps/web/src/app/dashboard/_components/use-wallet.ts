"use client";

import { useState } from "react";
import type { Address } from "viem";
import { connect, discoverWallets, ensureChain, friendlyError, walletClients, type PublicChain } from "@/lib/client/wallet";

type Status = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "done"; message: string } | { kind: "error"; message: string };

/**
 * Runs a wallet action (connect -> switch chain -> do something) with a status line for
 * the UI. `expectAccount` makes sure the right wallet is connected (e.g. the payout wallet).
 */
export function useWalletAction() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function run<T>(
    chain: PublicChain | null,
    action: (ctx: {
      account: Address;
      clients: ReturnType<typeof walletClients>;
      setLabel: (label: string) => void;
    }) => Promise<T>,
    opts: { expectAccount?: string | null; successMessage?: string } = {},
  ): Promise<T | undefined> {
    try {
      setStatus({ kind: "busy", label: "Waiting for your wallet…" });
      const wallets = await discoverWallets();
      const wallet = wallets[0];
      if (!wallet) throw new Error("No browser wallet found. Install MetaMask (or similar) and refresh.");
      const account = await connect(wallet.provider);
      if (opts.expectAccount && account.toLowerCase() !== opts.expectAccount.toLowerCase()) {
        throw new Error(`Switch your wallet to ${opts.expectAccount.slice(0, 6)}…${opts.expectAccount.slice(-4)} (your payout wallet) and try again.`);
      }
      if (chain) await ensureChain(wallet.provider, chain);
      const clients = walletClients(wallet.provider, chain ?? { id: 0, name: "", rpcUrl: null, explorerUrl: null, nativeCurrency: { name: "", symbol: "", decimals: 18 } }, account);
      const result = await action({ account, clients, setLabel: (label) => setStatus({ kind: "busy", label }) });
      setStatus(opts.successMessage ? { kind: "done", message: opts.successMessage } : { kind: "idle" });
      return result;
    } catch (e) {
      setStatus({ kind: "error", message: friendlyError(e) });
      return undefined;
    }
  }

  return { status, setStatus, run, busy: status.kind === "busy" };
}
