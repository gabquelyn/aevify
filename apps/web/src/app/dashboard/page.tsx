"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatAmount, formatDate, type ApiKey, type Payment, type Stats } from "./_components/api";
import { useDashboard } from "./_components/shell";
import { Card, Empty, PageHeader, Spinner, StatusBadge } from "./_components/ui";

export default function OverviewPage() {
  const { merchant } = useDashboard();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Payment[] | null>(null);
  const [keys, setKeys] = useState<ApiKey[] | null>(null);

  useEffect(() => {
    api<Stats>("/api/merchant/stats").then(setStats).catch(() => undefined);
    api<{ data: Payment[] }>("/api/merchant/payments?limit=5").then((d) => setRecent(d.data)).catch(() => setRecent([]));
    api<{ data: ApiKey[] }>("/api/merchant/keys").then((d) => setKeys(d.data)).catch(() => setKeys([]));
  }, []);

  const hasSecretKey = keys?.some((k) => k.kind === "secret" && !k.revokedAt) ?? false;
  const paidCount = stats ? stats.counts.paid + stats.counts.refunded : 0;
  const steps = [
    { done: true, label: "Create your business", href: "/dashboard/settings" },
    { done: merchant.readyForPayments, label: "Connect a payout wallet", href: "/dashboard/settings" },
    { done: hasSecretKey, label: "Create a secret API key", href: "/dashboard/developers" },
    { done: Boolean(merchant.webhookUrl), label: "Add a webhook URL", href: "/dashboard/developers" },
    { done: paidCount > 0, label: "Receive your first payment", href: "/dashboard/payments" },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <>
      <PageHeader title="Overview" description={`Payments to ${merchant.name}, settled in tUSD8 on Aevum.`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Volume" value={stats?.volume} unit={stats?.currency} />
        <Stat label="Net after fees & refunds" value={stats?.net} unit={stats?.currency} />
        <Stat label="Successful payments" value={stats ? String(paidCount) : undefined} />
        <Stat label="Awaiting payment" value={stats ? String(stats.counts.created) : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Last 14 days" subtitle={stats ? `${stats.fees} ${stats.currency} in fees · ${stats.refunded} ${stats.currency} refunded` : undefined}>
          {stats ? <VolumeChart daily={stats.daily} currency={stats.currency} /> : <Spinner />}
        </Card>

        {!setupDone && (
          <Card title="Get set up">
            <ol className="space-y-3">
              {steps.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        s.done ? "border-status-paid bg-status-paid text-white" : "border-line-strong text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span className={s.done ? "text-ink-muted line-through" : "hover:text-brand-600"}>{s.label}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      <Card
        className="mt-6"
        title="Recent payments"
        action={
          <Link href="/dashboard/payments" className="text-sm text-brand-600 hover:underline">
            View all
          </Link>
        }
      >
        {recent === null ? (
          <Spinner />
        ) : recent.length === 0 ? (
          <Empty title="No payments yet">Create a payment link on the Payments page, or call the API.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((p) => (
              <li key={p.id}>
                <Link href={`/dashboard/payments/${p.id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-surface-muted/60">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.description ?? (p.orderId ? `Order #${p.orderId}` : p.id)}</p>
                    <p className="text-xs text-ink-muted">{formatDate(p.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm tabular-nums">
                      {formatAmount(p.amount)} {p.currency}
                    </span>
                    <StatusBadge status={p.status} partialRefund={p.refunded !== "0.00"} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value?: string; unit?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-medium tracking-tight tabular-nums">{value === undefined ? "—" : unit ? formatAmount(value) : value}</span>
        {unit && value !== undefined && <span className="text-xs text-ink-faint">{unit}</span>}
      </p>
    </div>
  );
}

function VolumeChart({ daily, currency }: { daily: Stats["daily"]; currency: string }) {
  const values = daily.map((d) => Number(d.volume));
  const max = Math.max(...values, 1);
  const empty = values.every((v) => v === 0);
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Daily volume in ${currency} for the last 14 days`}>
        {daily.map((d) => {
          const v = Number(d.volume);
          return (
            <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className={`w-full rounded-t-md ${v > 0 ? "bg-brand-400 group-hover:bg-brand-500" : "bg-line"}`}
                style={{ height: `${v > 0 ? Math.max((v / max) * 100, 4) : 2}%` }}
              />
              <div className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white group-hover:block">
                {formatAmount(d.volume)} {currency} · {d.count}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{daily[0]?.date.slice(5)}</span>
        <span>today</span>
      </div>
      {empty && <p className="mt-3 text-sm text-ink-muted">Paid volume will show here.</p>}
    </div>
  );
}
