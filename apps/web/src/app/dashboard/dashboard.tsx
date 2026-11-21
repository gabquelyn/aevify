"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

/**
 * Basic merchant dashboard: business profile, payout wallet, API keys, webhooks and
 * recent payments. Enough to use the API end to end; the full dashboard comes next.
 */

type Merchant = {
  id: string;
  name: string;
  slug: string;
  onchain: {
    merchantId: string;
    status: "not_registered" | "pending" | "registered";
    payoutAddress: string | null;
    pendingPayoutAddress: string | null;
    pendingPayoutEffectiveAt: string | null;
    lastTxHash: string | null;
  };
  webhookUrl: string | null;
  webhookSecret: string;
  readyForPayments: boolean;
};
type ApiKey = { id: string; kind: "secret" | "publishable"; key: string | null; preview: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Payment = { id: string; status: string; amount: string; currency: string; orderId: string | null; createdAt: string; checkoutUrl: string; txHash: string | null };

type EthereumProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const EXPLORER = "https://explorer-test.qday.info";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export function Dashboard({ email }: { email: string }) {
  const router = useRouter();
  const [merchant, setMerchant] = useState<Merchant | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ merchant: Merchant | null }>("/api/merchant");
      setMerchant(data.merchant);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    await authClient.signOut();
    router.push("/");
  }

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-4 text-sm text-ink-muted">
            <span className="hidden sm:inline">{email}</span>
            <button onClick={signOut} className="hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        {error && <Banner tone="error">{error}</Banner>}
        {merchant === undefined && !error && <p className="text-sm text-ink-muted">Loading…</p>}
        {merchant === null && <Onboarding onCreated={setMerchant} />}
        {merchant && (
          <>
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-brand-600">Dashboard</p>
              <h1 className="mt-2 text-3xl font-medium tracking-tight">{merchant.name}</h1>
              <p className="mt-1 font-mono text-xs text-ink-faint">{merchant.slug}</p>
            </div>
            {!merchant.readyForPayments && (
              <Banner tone="info">Connect a payout wallet to start accepting payments.</Banner>
            )}
            <PayoutWallet merchant={merchant} onChange={setMerchant} />
            <ApiKeys />
            <Webhooks merchant={merchant} onChange={setMerchant} />
            <RecentPayments />
          </>
        )}
      </main>
    </div>
  );
}

// --- Sections ------------------------------------------------------------------

function Onboarding({ onCreated }: { onCreated: (m: Merchant) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ merchant: Merchant }>("/api/merchant", { method: "POST", body: JSON.stringify({ name }) });
      onCreated(data.merchant);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Create your business" subtitle="This name is shown to customers at checkout.">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <input
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Business name"
          className={inputClass}
        />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </PrimaryButton>
      </form>
      {error && <p className="mt-3 text-sm text-status-failed">{error}</p>}
    </Card>
  );
}

function PayoutWallet({ merchant, onChange }: { merchant: Merchant; onChange: (m: Merchant) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const { onchain } = merchant;
  const changeDue = onchain.pendingPayoutEffectiveAt && new Date(onchain.pendingPayoutEffectiveAt) <= new Date();

  async function connect() {
    setMessage(null);
    if (!window.ethereum) {
      setMessage({ tone: "error", text: "No browser wallet found. Install MetaMask (or similar) and add the Aevum network." });
      return;
    }
    try {
      setBusy("Waiting for your wallet…");
      const [address] = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (!address) throw new Error("No account selected.");
      const challenge = await api<{ message: string }>("/api/merchant/payout-wallet/challenge", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      setBusy("Sign the message in your wallet (free, no transaction)…");
      const signature = (await window.ethereum.request({ method: "personal_sign", params: [challenge.message, address] })) as string;
      setBusy("Registering your wallet on Aevum…");
      const result = await api<{ merchant: Merchant; notice?: string; confirmed: boolean }>("/api/merchant/payout-wallet", {
        method: "POST",
        body: JSON.stringify({ address, signature }),
      });
      onChange(result.merchant);
      setMessage({
        tone: "info",
        text: result.notice ?? (result.confirmed ? "Payout wallet connected." : "Submitted. It'll show as connected once confirmed."),
      });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy("Applying the change on Aevum…");
    try {
      const result = await api<{ merchant: Merchant }>("/api/merchant/payout-wallet/apply", { method: "POST" });
      onChange(result.merchant);
      setMessage({ tone: "info", text: "Payout wallet updated." });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Payout wallet" subtitle="Payments settle straight to this wallet on Aevum, minus the 3% fee.">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <StatusPill status={onchain.status} />
          <p className="mt-2 truncate font-mono text-sm">{onchain.payoutAddress ?? "No wallet connected"}</p>
          {onchain.pendingPayoutAddress && (
            <p className="mt-1 text-xs text-ink-muted">
              Changing to <span className="font-mono">{onchain.pendingPayoutAddress}</span>{" "}
              {changeDue ? "(ready to apply)" : `on ${new Date(onchain.pendingPayoutEffectiveAt!).toLocaleString()}`}
            </p>
          )}
          {onchain.lastTxHash && (
            <a href={`${EXPLORER}/tx/${onchain.lastTxHash}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
              View last transaction
            </a>
          )}
        </div>
        <div className="flex gap-2">
          {changeDue && (
            <SecondaryButton onClick={apply} disabled={Boolean(busy)}>
              Apply change
            </SecondaryButton>
          )}
          <PrimaryButton onClick={connect} disabled={Boolean(busy) || onchain.status === "pending"}>
            {onchain.payoutAddress ? "Change wallet" : "Connect wallet"}
          </PrimaryButton>
        </div>
      </div>
      {busy && <p className="mt-4 text-sm text-ink-muted">{busy}</p>}
      {message && <p className={`mt-4 text-sm ${message.tone === "error" ? "text-status-failed" : "text-ink-muted"}`}>{message.text}</p>}
    </Card>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys((await api<{ data: ApiKey[] }>("/api/merchant/keys")).data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function createSecret() {
    setError(null);
    try {
      const data = await api<{ key: ApiKey }>("/api/merchant/keys", { method: "POST", body: JSON.stringify({ kind: "secret" }) });
      setRevealed(data.key.key);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Requests using it will fail immediately.")) return;
    try {
      await api(`/api/merchant/keys/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = keys.filter((k) => !k.revokedAt);
  return (
    <Card
      title="API keys"
      subtitle="Use the secret key from your server only. The publishable key is safe in the browser."
      action={<PrimaryButton onClick={createSecret}>Create secret key</PrimaryButton>}
    >
      {revealed && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-medium">Copy your secret key now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-3 py-2 font-mono text-xs">{revealed}</code>
            <CopyButton value={revealed} />
          </div>
          <button onClick={() => setRevealed(null)} className="mt-2 text-xs text-ink-muted hover:text-ink">
            I&apos;ve saved it
          </button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {active.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium capitalize">{k.kind} key</p>
              <p className="truncate font-mono text-xs text-ink-muted">{k.key ?? k.preview}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {k.key && <CopyButton value={k.key} />}
              <button onClick={() => revoke(k.id)} className="text-xs text-ink-muted hover:text-status-failed">
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-status-failed">{error}</p>}
    </Card>
  );
}

function Webhooks({ merchant, onChange }: { merchant: Merchant; onChange: (m: Merchant) => void }) {
  const [url, setUrl] = useState(merchant.webhookUrl ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const data = await api<{ merchant: Merchant }>("/api/merchant", {
        method: "PATCH",
        body: JSON.stringify({ webhookUrl: url.trim() || null }),
      });
      onChange(data.merchant);
      setStatus("Saved.");
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function rotate() {
    if (!confirm("Rotate the webhook secret? Your server must use the new secret to verify events.")) return;
    const data = await api<{ merchant: Merchant }>("/api/merchant/webhook-secret", { method: "POST" });
    onChange(data.merchant);
    setShowSecret(true);
  }

  return (
    <Card title="Webhooks" subtitle="We'll POST signed events (payment.paid, payment.expired, payment.refunded) to this URL.">
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-store.com/api/aevify/webhook" className={inputClass} />
        <SecondaryButton type="submit">Save</SecondaryButton>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">Signing secret:</span>
        <code className="font-mono text-xs">{showSecret ? merchant.webhookSecret : "whsec_••••••••••••"}</code>
        <button onClick={() => setShowSecret((s) => !s)} className="text-xs text-brand-600 hover:underline">
          {showSecret ? "Hide" : "Reveal"}
        </button>
        {showSecret && <CopyButton value={merchant.webhookSecret} />}
        <button onClick={rotate} className="text-xs text-ink-muted hover:text-ink">
          Rotate
        </button>
      </div>
      {status && <p className="mt-3 text-sm text-ink-muted">{status}</p>}
    </Card>
  );
}

function RecentPayments() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  useEffect(() => {
    api<{ data: Payment[] }>("/api/merchant/payments?limit=10")
      .then((d) => setPayments(d.data))
      .catch(() => setPayments([]));
  }, []);

  return (
    <Card title="Recent payments">
      {payments === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No payments yet. Create one with <code className="font-mono text-xs">POST /api/v1/payments</code>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="py-2 font-normal">Payment</th>
                <th className="py-2 font-normal">Amount</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 font-mono text-xs">
                    <a href={p.checkoutUrl} target="_blank" rel="noreferrer" className="hover:text-brand-600">
                      {p.id}
                    </a>
                    {p.orderId && <span className="ml-2 text-ink-faint">#{p.orderId}</span>}
                  </td>
                  <td className="py-2.5">
                    {p.amount} {p.currency}
                  </td>
                  <td className="py-2.5">
                    <PaymentStatus status={p.status} txHash={p.txHash} />
                  </td>
                  <td className="py-2.5 text-ink-muted">{new Date(p.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --- UI bits -------------------------------------------------------------------

const inputClass =
  "w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-faint focus:border-brand-400 focus:ring-4 focus:ring-brand-100";

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="shrink-0 rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
    />
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="shrink-0 rounded-full border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:border-ink-faint disabled:opacity-50"
    />
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs text-brand-600 hover:underline"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Banner({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  const styles = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-brand-200 bg-brand-50 text-brand-700";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function StatusPill({ status }: { status: Merchant["onchain"]["status"] }) {
  const map = {
    registered: ["Verified on Aevum", "bg-green-50 text-status-paid border-green-200"],
    pending: ["Confirming on Aevum", "bg-amber-50 text-status-pending border-amber-200"],
    not_registered: ["Not connected", "bg-surface-muted text-ink-muted border-line"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function PaymentStatus({ status, txHash }: { status: string; txHash: string | null }) {
  const cls =
    status === "paid"
      ? "text-status-paid"
      : status === "created"
        ? "text-status-pending"
        : status === "refunded"
          ? "text-brand-600"
          : "text-ink-faint";
  const label = status === "created" ? "awaiting payment" : status;
  return txHash ? (
    <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className={`${cls} hover:underline`}>
      {label}
    </a>
  ) : (
    <span className={cls}>{label}</span>
  );
}
