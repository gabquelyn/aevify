"use client";

import { aevifyCheckoutAbi } from "@aevify/shared";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { api, formatAmount, formatDate, type Payment } from "../../_components/api";
import { useDashboard } from "../../_components/shell";
import { Banner, Card, CopyButton, Field, inputClass, PrimaryButton, Spinner, StatusBadge } from "../../_components/ui";
import { useWalletAction } from "../../_components/use-wallet";
import { WalletStatusView } from "../../_components/wallet-status";

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPayment(await api<Payment>(`/api/merchant/payments/${id}`));
    } catch (e) {
      setError((e as Error).message);
      setPayment(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (payment === undefined) return <Spinner />;
  if (payment === null) return <Banner tone="error">{error ?? "Payment not found."}</Banner>;

  // Exact, in base units (6 decimals), then formatted.
  const units = (v: string) => BigInt(Math.round(Number(v) * 1e6));
  const net =
    payment.fee !== null
      ? (Number(units(payment.amount) - units(payment.fee) - units(payment.refunded)) / 1e6).toString()
      : null;

  return (
    <>
      <Link href="/dashboard/payments" className="text-sm text-ink-muted hover:text-ink">
        ← Payments
      </Link>
      <div className="mb-8 mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-medium tracking-tight tabular-nums">{formatAmount(payment.amount)}</span>
            <span className="text-ink-muted">{payment.currency}</span>
            <StatusBadge status={payment.status} partialRefund={payment.refunded !== "0.00"} />
          </p>
          <p className="mt-1 text-sm text-ink-muted">{payment.description ?? (payment.orderId ? `Order #${payment.orderId}` : "Payment")}</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-ink-muted">
          {payment.id} <CopyButton value={payment.id} />
        </div>
      </div>

      {notice && (
        <div className="mb-6">
          <Banner tone="success">{notice}</Banner>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Timeline">
            <Timeline payment={payment} />
          </Card>

          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[160px_1fr]">
              <Detail label="Amount">{formatAmount(payment.amount)} {payment.currency}</Detail>
              {payment.fee !== null && <Detail label="Aevify fee">{formatAmount(payment.fee)} {payment.currency}</Detail>}
              {payment.refunded !== "0.00" && <Detail label="Refunded">{formatAmount(payment.refunded)} {payment.currency}</Detail>}
              {net !== null && <Detail label="Net to you">{formatAmount(net)} {payment.currency}</Detail>}
              {payment.orderId && <Detail label="Order reference">{payment.orderId}</Detail>}
              {payment.paidBy && <Detail label="Paid by" mono>{payment.paidBy}</Detail>}
              {payment.payer && <Detail label="Payable only by" mono>{payment.payer}</Detail>}
              {payment.txHash && (
                <Detail label="Transaction" mono>
                  <TxLink hash={payment.txHash} />
                </Detail>
              )}
              <Detail label="Checkout link">
                <span className="flex items-center gap-2">
                  <a href={payment.checkoutUrl} target="_blank" rel="noreferrer" className="truncate text-brand-600 hover:underline">
                    {payment.checkoutUrl}
                  </a>
                  <CopyButton value={payment.checkoutUrl} />
                </span>
              </Detail>
              <Detail label="On-chain ID" mono>
                {payment.onchain.paymentId}
              </Detail>
              {Object.entries(payment.metadata).map(([k, v]) => (
                <Detail key={k} label={`metadata.${k}`}>
                  {v}
                </Detail>
              ))}
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          {payment.status === "paid" && (
            <RefundCard
              payment={payment}
              onRefunded={async (message) => {
                setNotice(message);
                await load();
              }}
            />
          )}
          {payment.status === "created" && (
            <Card title="Awaiting payment">
              <p className="text-sm text-ink-muted">Expires {formatDate(payment.expiresAt)}. Share the checkout link with your customer.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Detail({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`min-w-0 break-all ${mono ? "font-mono text-xs leading-5" : ""}`}>{children}</dd>
    </>
  );
}

function TxLink({ hash }: { hash: string }) {
  const { config } = useDashboard();
  const url = config?.chain.explorerUrl ? `${config.chain.explorerUrl}/tx/${hash}` : null;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
      {hash}
    </a>
  ) : (
    <>{hash}</>
  );
}

function Timeline({ payment }: { payment: Payment }) {
  const events: { label: string; at: string | null; tone: "done" | "muted" }[] = [{ label: "Payment request created", at: payment.createdAt, tone: "done" }];
  if (payment.paidAt) events.push({ label: `Paid${payment.paidBy ? ` by ${payment.paidBy.slice(0, 6)}…${payment.paidBy.slice(-4)}` : ""}`, at: payment.paidAt, tone: "done" });
  if (payment.status === "refunded") events.push({ label: "Fully refunded", at: null, tone: "done" });
  else if (payment.refunded !== "0.00") events.push({ label: `Partially refunded (${payment.refunded} ${payment.currency})`, at: null, tone: "done" });
  if (payment.status === "expired") events.push({ label: "Expired without payment", at: payment.expiresAt, tone: "muted" });
  if (payment.status === "created") events.push({ label: "Waiting for the customer", at: null, tone: "muted" });

  return (
    <ol className="space-y-4">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${e.tone === "done" ? "bg-brand-500" : "bg-line-strong"}`} aria-hidden="true" />
          <div>
            <p className="text-sm">{e.label}</p>
            {e.at && <p className="text-xs text-ink-muted">{formatDate(e.at)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Refunds are sent on-chain from the merchant's payout wallet straight to the customer. */
function RefundCard({ payment, onRefunded }: { payment: Payment; onRefunded: (message: string) => Promise<void> }) {
  const { merchant, config } = useDashboard();
  const remaining = (Number(payment.amount) - Number(payment.refunded)).toFixed(6).replace(/\.?0+$/, "");
  const [amount, setAmount] = useState(remaining);
  const { status, run, pick, reset, busy } = useWalletAction();

  async function refund(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    const value = parseUnits(amount, config.token.decimals);
    const ok = await run(
      config.chain,
      async ({ account, clients: { publicClient, walletClient }, setLabel }) => {
        const balance = await publicClient.readContract({ address: config.token.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
        if (balance < value) {
          throw new Error(`Your payout wallet has ${formatUnits(balance, config.token.decimals)} ${config.token.symbol}; the refund needs ${amount}.`);
        }
        const allowance = await publicClient.readContract({ address: config.token.address, abi: erc20Abi, functionName: "allowance", args: [account, config.checkoutAddress] });
        if (allowance < value) {
          setLabel(`Approve ${amount} ${config.token.symbol} in your wallet (1 of 2)…`);
          const { request } = await publicClient.simulateContract({ account, address: config.token.address, abi: erc20Abi, functionName: "approve", args: [config.checkoutAddress, value] });
          await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract(request) });
        }
        setLabel("Confirm the refund in your wallet (2 of 2)…");
        const { request } = await publicClient.simulateContract({
          account,
          address: config.checkoutAddress,
          abi: aevifyCheckoutAbi,
          functionName: "refund",
          args: [payment.onchain.paymentId, value],
        });
        const hash = await walletClient.writeContract(request);
        setLabel("Confirming on Aevum…");
        await publicClient.waitForTransactionReceipt({ hash });
        return true;
      },
      { expectAccount: merchant.onchain.payoutAddress },
    );
    if (ok) await onRefunded(`Refund of ${formatAmount(amount)} ${payment.currency} sent to the customer's wallet.`);
  }

  return (
    <Card title="Refund" subtitle="Sent from your payout wallet back to the customer, on-chain. The 3% fee isn't returned.">
      <form onSubmit={refund} className="space-y-3">
        <Field label={`Amount (${payment.currency})`} hint={`Up to ${remaining}`}>
          <input required inputMode="decimal" pattern="^\d+(\.\d{1,6})?$" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} disabled={busy} />
        </Field>
        <PrimaryButton type="submit" disabled={busy || !config || Number(amount) <= 0 || Number(amount) > Number(remaining)} className="w-full">
          {busy ? "Refunding…" : "Refund with payout wallet"}
        </PrimaryButton>
        <WalletStatusView status={status} onPick={pick} onReset={reset} />
      </form>
    </Card>
  );
}
