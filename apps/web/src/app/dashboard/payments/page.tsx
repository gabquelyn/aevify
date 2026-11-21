"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, formatAmount, formatDate, type Payment, type PaymentStatus } from "../_components/api";
import { useDashboard } from "../_components/shell";
import { Banner, Card, CopyButton, Empty, Field, inputClass, Modal, PageHeader, PrimaryButton, SecondaryButton, Spinner, StatusBadge } from "../_components/ui";

const FILTERS: { label: string; status?: PaymentStatus }[] = [
  { label: "All" },
  { label: "Paid", status: "paid" },
  { label: "Awaiting", status: "created" },
  { label: "Refunded", status: "refunded" },
  { label: "Expired", status: "expired" },
];

export default function PaymentsPage() {
  const { merchant } = useDashboard();
  const [filter, setFilter] = useState<PaymentStatus | undefined>(undefined);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (status?: PaymentStatus, after?: string) => {
    const qs = new URLSearchParams({ limit: "20" });
    if (status) qs.set("status", status);
    if (after) qs.set("startingAfter", after);
    return api<{ data: Payment[]; hasMore: boolean }>(`/api/merchant/payments?${qs}`);
  }, []);

  useEffect(() => {
    setPayments(null);
    load(filter).then((d) => {
      setPayments(d.data);
      setHasMore(d.hasMore);
    });
  }, [filter, load]);

  async function loadMore() {
    if (!payments?.length) return;
    setLoadingMore(true);
    const d = await load(filter, payments.at(-1)!.id);
    setPayments([...payments, ...d.data]);
    setHasMore(d.hasMore);
    setLoadingMore(false);
  }

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment request, from the API or from payment links."
        action={
          <PrimaryButton onClick={() => setCreating(true)} disabled={!merchant.readyForPayments}>
            New payment link
          </PrimaryButton>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            role="tab"
            aria-selected={filter === f.status}
            onClick={() => setFilter(f.status)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              filter === f.status ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="p-0">
        {payments === null ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-6">
            <Empty title={filter ? "No payments with this status" : "No payments yet"}>
              {!filter && "Create a payment link, or create payments from your server with the API."}
            </Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-6 py-3 font-normal">Amount</th>
                  <th className="px-3 py-3 font-normal">Status</th>
                  <th className="px-3 py-3 font-normal">Description</th>
                  <th className="px-3 py-3 font-normal">Customer</th>
                  <th className="px-6 py-3 text-right font-normal">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((p) => (
                  <tr key={p.id} className="group relative hover:bg-surface-muted/60">
                    <td className="px-6 py-3 tabular-nums">
                      <Link href={`/dashboard/payments/${p.id}`} className="after:absolute after:inset-0">
                        <span className="font-medium">{formatAmount(p.amount)}</span> <span className="text-ink-faint">{p.currency}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={p.status} partialRefund={p.refunded !== "0.00"} />
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3 text-ink-muted">{p.description ?? (p.orderId ? `Order #${p.orderId}` : p.id)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-ink-muted">{p.paidBy ? `${p.paidBy.slice(0, 6)}…${p.paidBy.slice(-4)}` : "—"}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-ink-muted">{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {hasMore && (
        <div className="mt-4 text-center">
          <SecondaryButton onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </SecondaryButton>
        </div>
      )}

      {creating && (
        <NewPaymentLink
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setPayments((list) => (list && !filter ? [p, ...list] : list));
          }}
        />
      )}
    </>
  );
}

function NewPaymentLink({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Payment) => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Payment | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payment = await api<Payment>("/api/merchant/payments", {
        method: "POST",
        json: {
          amount: amount.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(orderId.trim() ? { orderId: orderId.trim() } : {}),
          expiresInSeconds: Number(minutes) * 60,
        },
      });
      setCreated(payment);
      onCreated(payment);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={created ? "Payment link ready" : "New payment link"} onClose={onClose}>
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Share this link. It&apos;s valid until {formatDate(created.expiresAt)} and can be paid once.
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-muted px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{created.checkoutUrl}</code>
            <CopyButton value={created.checkoutUrl} />
          </div>
          <div className="flex gap-2">
            <a href={created.checkoutUrl} target="_blank" rel="noreferrer" className="flex-1">
              <PrimaryButton className="w-full">Open checkout</PrimaryButton>
            </a>
            <SecondaryButton onClick={onClose}>Done</SecondaryButton>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Amount (tUSD8)">
            <input required inputMode="decimal" pattern="^\d+(\.\d{1,6})?$" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" className={inputClass} autoFocus />
          </Field>
          <Field label="Description" hint="Shown to the customer at checkout.">
            <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Coffee beans, 1kg" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Order reference">
              <input maxLength={128} value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Optional" className={inputClass} />
            </Field>
            <Field label="Valid for">
              <select value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputClass}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
              </select>
            </Field>
          </div>
          {error && <Banner tone="error">{error}</Banner>}
          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create link"}
          </PrimaryButton>
        </form>
      )}
    </Modal>
  );
}
