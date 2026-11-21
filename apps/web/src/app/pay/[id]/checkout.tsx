"use client";

import { aevifyCheckoutAbi } from "@aevify/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits, parseSignature, type Address, type EIP1193Provider, type Hex } from "viem";
import { LogoMark } from "@/components/logo";
import {
  connect,
  discoverWallets,
  ensureChain,
  friendlyError,
  isMobileBrowser,
  metamaskDeepLink,
  shortAddress,
  walletClients,
  type WalletInfo,
} from "@/lib/client/wallet";
import type { CheckoutData } from "@/lib/payments";

/**
 * Hosted checkout. The customer never sees or types an address or an amount: they connect
 * a wallet, confirm, and the contract does the rest.
 *
 * Flow: connect -> switch to Aevum -> check balance -> pay
 *   - one step with an EIP-2612 permit signature, when the token supports it
 *   - otherwise approve, then pay (two wallet prompts)
 * Embedded (?embed=1, used by @aevify/react): results are sent to the parent page with postMessage.
 */

const permitAbi = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

type Wallet = { provider: EIP1193Provider; account: Address; name: string };
type Balances = { token: bigint; gas: bigint; allowance: bigint; permit: boolean };
type Phase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "working"; label: string; step?: string }
  | { kind: "confirming"; txHash: Hex }
  | { kind: "success"; txHash: Hex | null };

/** Messages for the embedding page (@aevify/react), sent only to its verified origin. */
function postToParent(parentOrigin: string | null, type: string, payload: Record<string, unknown>) {
  if (parentOrigin && typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage({ source: "aevify", type, ...payload }, parentOrigin);
  }
}

function withPaymentId(url: string, paymentId: string) {
  const u = new URL(url);
  u.searchParams.set("aevify_payment_id", paymentId);
  return u.toString();
}

function useCountdown(expiresAt: string | null) {
  // Starts at null so the server render and the first browser render match.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return { expired: false, label: "--:--", urgent: false };
  const ms = expiresAt ? new Date(expiresAt).getTime() - now : 0;
  const secs = Math.max(0, Math.floor(ms / 1000));
  return { expired: ms <= 0, label: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, urgent: secs < 120 };
}

export function Checkout({ initial, embed, parentOrigin = null }: { initial: CheckoutData; embed: boolean; parentOrigin?: string | null }) {
  const [data, setData] = useState(initial);
  const [wallets, setWallets] = useState<WalletInfo[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [phase, setPhase] = useState<Phase>(() =>
    initial.status === "paid" || initial.status === "refunded"
      ? { kind: "success", txHash: (initial.txHash as Hex | null) ?? null }
      : { kind: "idle" },
  );
  const [error, setError] = useState<string | null>(null);
  const countdown = useCountdown(data.expiresAt);
  const redirected = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  const amount = BigInt(data.amountBaseUnits);
  const { token, chain, contractCall } = data;
  const explorerTx = (hash: string) => (chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : null);
  const isPaid = data.status === "paid" || data.status === "refunded" || phase.kind === "success";
  const isExpired = !isPaid && (data.status === "expired" || countdown.expired);
  const busy = phase.kind === "connecting" || phase.kind === "working" || phase.kind === "confirming";

  useEffect(() => {
    postToParent(parentOrigin, "ready", { paymentId: data.id });
    void discoverWallets().then(setWallets);
  }, [data.id, parentOrigin]);

  // Let the embedding modal size itself to the content (measured on the content, not the
  // page, which stretches to the frame).
  useEffect(() => {
    const main = mainRef.current;
    if (!embed || !main) return;
    const report = () => postToParent(parentOrigin, "resize", { paymentId: data.id, height: Math.ceil(main.getBoundingClientRect().height) });
    const observer = new ResizeObserver(report);
    observer.observe(main);
    report();
    return () => observer.disconnect();
  }, [embed, parentOrigin, data.id]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/v1/checkout/${data.id}`, { cache: "no-store" });
    if (res.ok) {
      const next = (await res.json()) as CheckoutData;
      setData(next);
      return next;
    }
    return null;
  }, [data.id]);

  const readBalances = useCallback(
    async (w: Wallet) => {
      const { publicClient } = walletClients(w.provider, chain, w.account);
      const [tokenBalance, gas, allowance, permit] = await Promise.all([
        publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [w.account] }),
        publicClient.getBalance({ address: w.account }),
        publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [w.account, contractCall.address] }),
        publicClient
          .readContract({ address: token.address, abi: permitAbi, functionName: "eip712Domain" })
          .then(() => true)
          .catch(() => false),
      ]);
      const next = { token: tokenBalance, gas, allowance, permit };
      setBalances(next);
      return next;
    },
    [chain, token.address, contractCall.address],
  );

  async function connectWith(info: WalletInfo) {
    setError(null);
    setPhase({ kind: "connecting" });
    try {
      const account = await connect(info.provider);
      await ensureChain(info.provider, chain);
      const w = { provider: info.provider, account, name: info.name };
      setWallet(w);
      await readBalances(w);
      setPhase({ kind: "idle" });
    } catch (e) {
      setError(friendlyError(e));
      setPhase({ kind: "idle" });
    }
  }

  async function pay() {
    if (!wallet) return;
    setError(null);
    const { publicClient, walletClient } = walletClients(wallet.provider, chain, wallet.account);
    const request = {
      paymentId: contractCall.args.request.paymentId as Hex,
      merchantId: contractCall.args.request.merchantId as Hex,
      amount,
      expiresAt: BigInt(contractCall.args.request.expiresAt),
      payer: contractCall.args.request.payer as Address,
    };
    const signature = contractCall.args.signature as Hex;

    try {
      await ensureChain(wallet.provider, chain);
      const current = await readBalances(wallet);
      if (current.token < amount) throw new Error(`Not enough ${token.symbol} in this wallet.`);

      let hash: Hex | null = null;

      // One step: sign a permit, then pay in the same transaction.
      if (current.allowance < amount && current.permit) {
        try {
          setPhase({ kind: "working", label: "Sign to authorise the payment (free)", step: "1 of 2" });
          const [domain, nonce] = await Promise.all([
            publicClient.readContract({ address: token.address, abi: permitAbi, functionName: "eip712Domain" }),
            publicClient.readContract({ address: token.address, abi: permitAbi, functionName: "nonces", args: [wallet.account] }),
          ]);
          const deadline = request.expiresAt;
          const permitSig = await walletClient.signTypedData({
            account: wallet.account,
            domain: { name: domain[1], version: domain[2], chainId: Number(domain[3]), verifyingContract: domain[4] },
            types: {
              Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
              ],
            },
            primaryType: "Permit",
            message: { owner: wallet.account, spender: contractCall.address, value: amount, nonce, deadline },
          });
          const { r, s, v, yParity } = parseSignature(permitSig);
          setPhase({ kind: "working", label: `Confirm the payment of ${data.amount} ${token.symbol}`, step: "2 of 2" });
          const { request: tx } = await publicClient.simulateContract({
            account: wallet.account,
            address: contractCall.address,
            abi: aevifyCheckoutAbi,
            functionName: "payWithPermit",
            args: [request, signature, deadline, Number(v ?? BigInt(yParity + 27)), r, s],
          });
          hash = await walletClient.writeContract(tx);
        } catch (e) {
          // A cancelled signature is final; anything else falls back to approve + pay.
          if ((e as { code?: number })?.code === 4001 || /reject|denied|cancel/i.test(String((e as Error)?.message))) throw e;
          hash = null;
        }
      }

      // Two steps: approve exactly this amount, then pay.
      if (!hash) {
        if ((await readBalances(wallet)).allowance < amount) {
          setPhase({ kind: "working", label: `Approve ${data.amount} ${token.symbol}`, step: "1 of 2" });
          const { request: approveTx } = await publicClient.simulateContract({
            account: wallet.account,
            address: token.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [contractCall.address, amount],
          });
          const approveHash = await walletClient.writeContract(approveTx);
          setPhase({ kind: "working", label: "Waiting for the approval to confirm…", step: "1 of 2" });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        setPhase({ kind: "working", label: `Confirm the payment of ${data.amount} ${token.symbol}`, step: "2 of 2" });
        const { request: payTx } = await publicClient.simulateContract({
          account: wallet.account,
          address: contractCall.address,
          abi: aevifyCheckoutAbi,
          functionName: "pay",
          args: [request, signature],
        });
        hash = await walletClient.writeContract(payTx);
      }

      setPhase({ kind: "confirming", txHash: hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The payment transaction failed. You haven't been charged.");

      // Let Aevify catch up (it reads the contract), but don't keep the customer waiting long.
      for (let i = 0; i < 8; i++) {
        const next = await refresh();
        if (next?.status === "paid") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setPhase({ kind: "success", txHash: hash });
      postToParent(parentOrigin, "payment.paid", { paymentId: data.id, txHash: hash });
    } catch (e) {
      setError(friendlyError(e));
      setPhase({ kind: "idle" });
      if (wallet) void readBalances(wallet).catch(() => undefined);
    }
  }

  function cancel() {
    postToParent(parentOrigin, "payment.cancelled", { paymentId: data.id });
    if (!embed && data.cancelUrl) window.location.href = data.cancelUrl;
  }

  // After success, send the customer back to the store.
  useEffect(() => {
    if (phase.kind !== "success" || embed || !data.successUrl || redirected.current) return;
    redirected.current = true;
    const t = setTimeout(() => {
      window.location.href = withPaymentId(data.successUrl!, data.id);
    }, 4000);
    return () => clearTimeout(t);
  }, [phase.kind, embed, data.successUrl, data.id]);

  const payerLocked = data.payer && wallet && data.payer.toLowerCase() !== wallet.account.toLowerCase();
  const insufficient = balances && balances.token < amount;
  const noGas = balances && balances.gas === 0n;
  const fmt = (v: bigint) => Number(formatUnits(v, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const primary = useMemo(() => {
    if (!wallet) return null;
    if (payerLocked) return { label: "Wrong wallet", disabled: true };
    if (insufficient) return { label: `Not enough ${token.symbol}`, disabled: true };
    return { label: `Pay ${data.amount} ${token.symbol}`, disabled: busy };
  }, [wallet, payerLocked, insufficient, token.symbol, data.amount, busy]);

  return (
    <main ref={mainRef} className={`relative isolate flex items-start justify-center ${embed ? "px-1 pb-4 pt-2" : "min-h-dvh px-4 py-10 sm:items-center"}`}>
      {!embed && <div className="bg-dot-grid mask-fade-edges absolute inset-0 -z-10" aria-hidden="true" />}
      <div className="w-full max-w-[420px]">
        <section
          className={
            embed
              ? "overflow-hidden bg-surface" // the modal around it is the card
              : "overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)]"
          }
        >
          {/* Merchant and amount */}
          <div className="border-b border-line px-6 pb-6 pt-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-semibold text-brand-600">
                  {data.merchant.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{data.merchant.name}</p>
                  {data.merchant.verified ? (
                    <p
                      className="flex items-center gap-1 text-xs text-status-paid"
                      title={data.merchant.payoutAddress ? `Payouts go to ${data.merchant.payoutAddress}` : undefined}
                    >
                      <CheckIcon className="size-3.5" /> Verified on Aevum
                    </p>
                  ) : (
                    <p className="text-xs text-ink-faint">Unverified merchant</p>
                  )}
                </div>
              </div>
              {!isPaid && !isExpired && (
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-xs ${countdown.urgent ? "border-amber-200 bg-amber-50 text-status-pending" : "border-line text-ink-muted"}`}
                  aria-label="Time left to pay"
                >
                  {countdown.label}
                </span>
              )}
            </div>

            <p className="mt-6 text-xs font-medium uppercase tracking-wider text-ink-faint">{isPaid ? "Amount paid" : "Amount due"}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-medium tracking-tight">{data.amount}</span>
              <span className="text-lg text-ink-muted">{token.symbol}</span>
            </p>
            {data.description && <p className="mt-2 text-sm text-ink-muted">{data.description}</p>}

            <dl className="mt-5 space-y-2 text-sm">
              {data.orderId && <Row label="Order">#{data.orderId}</Row>}
              <Row label="Network">{chain.name}</Row>
              {data.payer && <Row label="Payable by">{shortAddress(data.payer)}</Row>}
            </dl>
          </div>

          {/* Action area */}
          <div className="px-6 py-6">
            {isPaid ? (
              <Success
                amount={`${data.amount} ${token.symbol}`}
                merchant={data.merchant.name}
                txUrl={(phase.kind === "success" && phase.txHash && explorerTx(phase.txHash)) || (data.txHash && explorerTx(data.txHash)) || null}
                refunded={data.status === "refunded"}
                returnUrl={!embed && data.successUrl ? withPaymentId(data.successUrl, data.id) : null}
              />
            ) : isExpired ? (
              <div className="text-center">
                <p className="font-medium">This payment request has expired</p>
                <p className="mt-1 text-sm text-ink-muted">Nothing was charged. Return to the store to start again.</p>
                {data.cancelUrl && !embed && (
                  <a href={data.cancelUrl} className="mt-4 inline-block text-sm text-brand-600 hover:underline">
                    Back to {data.merchant.name}
                  </a>
                )}
              </div>
            ) : !wallet ? (
              <div className="space-y-2.5">
                {wallets === null ? (
                  <p className="py-2 text-center text-sm text-ink-muted">Looking for wallets…</p>
                ) : wallets.length > 0 ? (
                  wallets.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => connectWith(w)}
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-2.5 rounded-full bg-brand-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {w.icon && <img src={w.icon} alt="" className="size-5 rounded" />}
                      {phase.kind === "connecting" ? "Connecting…" : wallets.length > 1 ? `Pay with ${w.name}` : "Connect wallet to pay"}
                    </button>
                  ))
                ) : isMobileBrowser() ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.location.href = metamaskDeepLink(window.location.href);
                    }}
                    className="flex w-full items-center justify-center rounded-full bg-brand-500 px-5 py-3 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    Open in MetaMask
                  </a>
                ) : (
                  <div className="rounded-2xl bg-surface-muted p-4 text-center text-sm text-ink-muted">
                    No wallet found. Install{" "}
                    <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                      MetaMask
                    </a>{" "}
                    and refresh this page.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-surface-muted px-4 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-status-paid" aria-hidden="true" />
                    <span className="font-mono">{shortAddress(wallet.account)}</span>
                  </span>
                  <span className={insufficient ? "text-status-failed" : "text-ink-muted"}>
                    {balances ? `${fmt(balances.token)} ${token.symbol}` : "…"}
                  </span>
                </div>

                {payerLocked && (
                  <Notice tone="error">This payment can only be paid by {shortAddress(data.payer!)}. Switch accounts in your wallet.</Notice>
                )}
                {insufficient && (
                  <Notice tone="error">
                    You need {data.amount} {token.symbol}.
                    {chain.faucetUrl && (
                      <>
                        {" "}
                        Get test tokens from the{" "}
                        <a href={chain.faucetUrl} target="_blank" rel="noreferrer" className="underline">
                          faucet
                        </a>
                        .
                      </>
                    )}
                  </Notice>
                )}
                {!insufficient && noGas && (
                  <Notice tone="warn">
                    This wallet has no {chain.nativeCurrency.symbol} for the network fee.
                    {chain.faucetUrl && (
                      <>
                        {" "}
                        <a href={chain.faucetUrl} target="_blank" rel="noreferrer" className="underline">
                          Get some from the faucet
                        </a>
                        .
                      </>
                    )}
                  </Notice>
                )}

                {primary && (
                  <button
                    onClick={pay}
                    disabled={primary.disabled}
                    className="w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {phase.kind === "working" || phase.kind === "confirming" ? "Processing…" : primary.label}
                  </button>
                )}

                {phase.kind === "working" && (
                  <Progress label={phase.label} step={phase.step} />
                )}
                {phase.kind === "confirming" && (
                  <Progress
                    label="Confirming on Aevum…"
                    link={explorerTx(phase.txHash) ? { href: explorerTx(phase.txHash)!, text: "View transaction" } : undefined}
                  />
                )}
              </div>
            )}

            {error && !isPaid && <Notice tone="error" className="mt-4">{error}</Notice>}
          </div>
        </section>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between px-2 text-xs text-ink-faint">
          <span className="flex items-center gap-1.5">
            <LogoMark className="size-3 text-brand-500" /> Secured by Aevify
          </span>
          {!isPaid && (data.cancelUrl || embed) && (
            <button onClick={cancel} className="hover:text-ink">
              Cancel and return
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}

function Notice({ tone, children, className = "" }: { tone: "error" | "warn"; children: React.ReactNode; className?: string }) {
  const styles = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <p role={tone === "error" ? "alert" : undefined} className={`rounded-2xl border px-4 py-3 text-sm ${styles} ${className}`}>
      {children}
    </p>
  );
}

function Progress({ label, step, link }: { label: string; step?: string; link?: { href: string; text: string } }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-muted" aria-live="polite">
      <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" aria-hidden="true" />
      <span className="flex-1">
        {step && <span className="mr-1.5 font-mono text-xs text-ink-faint">Step {step}</span>}
        {label}
      </span>
      {link && (
        <a href={link.href} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
          {link.text}
        </a>
      )}
    </div>
  );
}

function Success({ amount, merchant, txUrl, refunded, returnUrl }: { amount: string; merchant: string; txUrl: string | null; refunded: boolean; returnUrl: string | null }) {
  return (
    <div className="text-center" aria-live="polite">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-50 text-status-paid">
        <CheckIcon className="size-6" />
      </span>
      <p className="mt-4 text-lg font-medium">{refunded ? "Payment refunded" : "Payment complete"}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {refunded ? `${merchant} refunded ${amount} to your wallet.` : `You paid ${amount} to ${merchant}`}
        {!refunded && !merchant.endsWith(".") && "."}
      </p>
      <div className="mt-5 flex flex-col items-center gap-2 text-sm">
        {txUrl && (
          <a href={txUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
            View receipt on the Aevum explorer
          </a>
        )}
        {returnUrl && (
          <a href={returnUrl} className="text-ink-muted hover:text-ink">
            Returning you to {merchant}…
          </a>
        )}
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}
