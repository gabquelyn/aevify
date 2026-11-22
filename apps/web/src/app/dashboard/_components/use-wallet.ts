"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { connect, discoverWallets, ensureChain, friendlyError, walletClients, type PublicChain, type WalletInfo } from "@/lib/client/wallet";

export type WalletStatus =
  | { kind: "idle" }
  | { kind: "choose"; wallets: WalletInfo[] }
  | { kind: "busy"; label: string; slow?: boolean }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const LAST_WALLET_KEY = "aevify:last-wallet";
/** After this long without an answer from the wallet, show what to check. */
const SLOW_AFTER_MS = 12_000;

function rememberWallet(id: string) {
  try {
    localStorage.setItem(LAST_WALLET_KEY, id);
  } catch {
    /* storage unavailable: just don't remember */
  }
}

function lastWallet(): string | null {
  try {
    return localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
}

/**
 * Runs a wallet action (pick wallet -> connect -> switch chain -> do something) with a status
 * for the UI. With several wallet extensions installed, the user picks one (and it's
 * remembered), so the request never lands in an extension they aren't looking at.
 * `expectAccount` makes sure the right account is connected (e.g. the payout wallet).
 */
export function useWalletAction() {
  const [status, setStatus] = useState<WalletStatus>({ kind: "idle" });
  const pickRef = useRef<((wallet: WalletInfo | null) => void) | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped by reset(), so a wallet answering after "stop waiting" is ignored. */
  const generation = useRef(0);

  useEffect(() => () => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
  }, []);

  function setBusy(label: string) {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setStatus({ kind: "busy", label });
    slowTimer.current = setTimeout(() => setStatus((s) => (s.kind === "busy" ? { ...s, slow: true } : s)), SLOW_AFTER_MS);
  }

  function settle(next: WalletStatus) {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setStatus(next);
  }

  async function chooseWallet(): Promise<WalletInfo | null> {
    const wallets = await discoverWallets();
    if (wallets.length === 0) throw new Error("No browser wallet found. Install MetaMask (or similar) and refresh.");
    if (wallets.length === 1) return wallets[0]!;
    const remembered = wallets.find((w) => w.id === lastWallet());
    if (remembered) return remembered;
    return new Promise((resolve) => {
      pickRef.current = resolve;
      settle({ kind: "choose", wallets });
    });
  }

  /** Called by the wallet picker. `null` cancels. */
  function pick(wallet: WalletInfo | null) {
    pickRef.current?.(wallet);
    pickRef.current = null;
  }

  /** Forget the remembered wallet and stop waiting, so the next try asks again. */
  function reset() {
    try {
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch {
      /* ignore */
    }
    generation.current += 1;
    pick(null);
    settle({ kind: "idle" });
  }

  async function run<T>(
    chain: PublicChain | null,
    action: (ctx: {
      account: Address;
      clients: ReturnType<typeof walletClients>;
      setLabel: (label: string) => void;
    }) => Promise<T>,
    opts: { expectAccount?: string | null; successMessage?: string } = {},
  ): Promise<T | undefined> {
    const gen = generation.current;
    const stale = () => gen !== generation.current;
    try {
      setBusy("Looking for your wallet…");
      const wallet = await chooseWallet();
      if (!wallet) {
        settle({ kind: "idle" });
        return undefined;
      }
      rememberWallet(wallet.id);
      setBusy(`Waiting for ${wallet.name}… approve the request in its pop-up.`);
      const account = await connect(wallet.provider);
      if (stale()) return undefined;
      if (opts.expectAccount && account.toLowerCase() !== opts.expectAccount.toLowerCase()) {
        throw new Error(`Switch your wallet to ${opts.expectAccount.slice(0, 6)}…${opts.expectAccount.slice(-4)} (your payout wallet) and try again.`);
      }
      if (chain) {
        setBusy(`Switching ${wallet.name} to ${chain.name}…`);
        await ensureChain(wallet.provider, chain);
        if (stale()) return undefined;
      }
      const clients = walletClients(wallet.provider, chain ?? { id: 0, name: "", rpcUrl: null, explorerUrl: null, nativeCurrency: { name: "", symbol: "", decimals: 18 } }, account);
      const result = await action({ account, clients, setLabel: setBusy });
      settle(opts.successMessage ? { kind: "done", message: opts.successMessage } : { kind: "idle" });
      return result;
    } catch (e) {
      if (stale()) return undefined;
      settle({ kind: "error", message: friendlyError(e) });
      return undefined;
    }
  }

  return { status, setStatus: settle, run, pick, reset, busy: status.kind === "busy" || status.kind === "choose" };
}
