"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatDate, type ApiKey, type Merchant } from "../_components/api";
import { useDashboard } from "../_components/shell";
import { Banner, Card, CopyButton, Field, inputClass, PageHeader, PrimaryButton, SecondaryButton, Spinner } from "../_components/ui";

export default function DevelopersPage() {
  return (
    <>
      <PageHeader title="Developers" description="API keys, webhooks and a quick start for your server." />
      <div className="space-y-6">
        <ApiKeys />
        <AllowedDomains />
        <Webhooks />
        <Deliveries />
        <QuickStart />
      </div>
    </>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKeys((await api<{ data: ApiKey[] }>("/api/merchant/keys")).data);
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function createSecret() {
    setError(null);
    try {
      setRevealed((await api<{ key: ApiKey }>("/api/merchant/keys", { method: "POST", json: { kind: "secret" } })).key.key);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(key: ApiKey) {
    if (!confirm(`Revoke this ${key.kind} key? Anything using it stops working immediately.`)) return;
    try {
      await api(`/api/merchant/keys/${key.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = keys?.filter((k) => !k.revokedAt) ?? [];
  return (
    <Card
      title="API keys"
      subtitle={
        <>
          Use a <strong className="font-medium text-ink">secret key</strong> from your server only. The{" "}
          <strong className="font-medium text-ink">publishable key</strong> is safe in the browser.
        </>
      }
      action={<PrimaryButton onClick={createSecret}>Create secret key</PrimaryButton>}
    >
      {revealed && (
        <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-medium">Copy your secret key now. You won&apos;t be able to see it again.</p>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="new-secret-key">
              {revealed}
            </code>
            <CopyButton value={revealed} />
          </div>
          <button onClick={() => setRevealed(null)} className="mt-2 text-xs text-ink-muted hover:text-ink">
            I&apos;ve stored it safely
          </button>
        </div>
      )}
      {keys === null ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line">
          {active.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize">{k.kind} key</p>
                <p className="truncate font-mono text-xs text-ink-muted">{k.key ?? k.preview}</p>
                <p className="text-xs text-ink-faint">
                  Created {formatDate(k.createdAt)}
                  {k.kind === "secret" && ` · ${k.lastUsedAt ? `last used ${formatDate(k.lastUsedAt)}` : "never used"}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {k.key && <CopyButton value={k.key} />}
                <button onClick={() => revoke(k)} className="text-xs text-ink-muted hover:text-status-failed">
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
    </Card>
  );
}

function Webhooks() {
  const { merchant, setMerchant } = useDashboard();
  const [url, setUrl] = useState(merchant.webhookUrl ?? "");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMerchant((await api<{ merchant: Merchant }>("/api/merchant", { method: "PATCH", json: { webhookUrl: url.trim() || null } })).merchant);
      setStatus({ tone: "success", text: url.trim() ? "Webhook URL saved." : "Webhook URL removed." });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error).message });
    }
  }

  async function rotate() {
    if (!confirm("Rotate the signing secret? Update your server to the new secret, or it will reject events.")) return;
    setMerchant((await api<{ merchant: Merchant }>("/api/merchant/webhook-secret", { method: "POST" })).merchant);
    setShow(true);
  }

  return (
    <Card title="Webhooks" subtitle="Aevify POSTs signed events to your server: payment.paid, payment.expired and payment.refunded.">
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Endpoint URL">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-store.com/api/aevify/webhook" className={inputClass} />
          </Field>
        </div>
        <SecondaryButton type="submit">Save</SecondaryButton>
      </form>
      <div className="mt-5 rounded-xl border border-line bg-surface-muted p-4">
        <p className="text-sm font-medium">Signing secret</p>
        <p className="mt-0.5 text-xs text-ink-muted">Verify the Aevify-Signature header with this, so you only trust events from Aevify.</p>
        {/* Long and unbroken: give it its own line that can break anywhere (narrow screens). */}
        <code className="mt-3 block w-full min-w-0 break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed" data-testid="webhook-secret">
          {show ? merchant.webhookSecret : "whsec_••••••••••••••••••••"}
        </code>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button onClick={() => setShow((s) => !s)} className="text-xs font-medium text-brand-600 hover:underline">
            {show ? "Hide" : "Reveal"}
          </button>
          {show && <CopyButton value={merchant.webhookSecret} />}
          <button onClick={rotate} className="text-xs text-ink-muted hover:text-ink">
            Rotate
          </button>
        </div>
      </div>
      {status && (
        <div className="mt-3">
          <Banner tone={status.tone}>{status.text}</Banner>
        </div>
      )}
    </Card>
  );
}

function QuickStart() {
  const [origin, setOrigin] = useState("https://your-app");
  useEffect(() => setOrigin(window.location.origin), []);
  const snippet = `curl -X POST ${origin}/api/v1/payments \\
  -H "Authorization: Bearer $AEVIFY_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{ "amount": "25.00", "orderId": "1042", "successUrl": "https://your-store.com/thanks" }'`;
  return (
    <Card title="Quick start" subtitle="Create a payment from your server, then send the customer to its checkoutUrl.">
      <div className="relative rounded-xl bg-ink p-4">
        <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-slate-200">{snippet}</pre>
        <div className="absolute right-3 top-3">
          <CopyButton value={snippet} />
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        The response includes <code className="font-mono text-xs">checkoutUrl</code>. Full reference:{" "}
          <a href="/docs/api" className="font-medium text-brand-600 hover:underline">
            API docs
          </a>
          .
      </p>
    </Card>
  );
}

type Delivery = {
  id: string;
  type: string;
  paymentId: string | null;
  status: "pending" | "sending" | "succeeded" | "failed" | "no_endpoint";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

const DELIVERY_STATUS: Record<Delivery["status"], { label: string; className: string }> = {
  pending: { label: "Queued", className: "border-amber-200 bg-amber-50 text-status-pending" },
  sending: { label: "Sending", className: "border-amber-200 bg-amber-50 text-status-pending" },
  succeeded: { label: "Delivered", className: "border-green-200 bg-green-50 text-status-paid" },
  failed: { label: "Failed", className: "border-red-200 bg-red-50 text-status-failed" },
  no_endpoint: { label: "No URL set", className: "border-line bg-surface-muted text-ink-muted" },
};

function Deliveries() {
  const { merchant } = useDashboard();
  const [items, setItems] = useState<Delivery[] | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setItems((await api<{ data: Delivery[] }>("/api/merchant/webhook-deliveries?limit=15")).data);
  }, []);

  useEffect(() => {
    void load().catch(() => setItems([]));
    // Refresh while anything is in flight.
    const t = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function sendTest() {
    setMessage(null);
    try {
      await api("/api/merchant/webhooks/test", { method: "POST" });
      setMessage({ tone: "success", text: "Test event queued. It appears below once the listener sends it." });
      await load();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  }

  async function resend(id: string) {
    try {
      await api(`/api/merchant/webhook-deliveries/${id}/resend`, { method: "POST" });
      await load();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  }

  return (
    <Card
      title="Webhook deliveries"
      subtitle="Every event Aevify sends, with retries over about 22 hours if your server doesn't answer with 2xx."
      action={
        <SecondaryButton onClick={sendTest} disabled={!merchant.webhookUrl} title={merchant.webhookUrl ? undefined : "Add a webhook URL first"}>
          Send test event
        </SecondaryButton>
      }
    >
      {message && (
        <div className="mb-4">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">No events yet. They appear here when payments are paid, refunded or expire.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((d) => {
            const s = DELIVERY_STATUS[d.status];
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs">{d.type}</span>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {formatDate(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                    {d.lastStatusCode !== null && ` · HTTP ${d.lastStatusCode}`}
                    {d.lastError && ` · ${d.lastError}`}
                    {d.nextAttemptAt && d.attempts > 0 && ` · retrying ${formatDate(d.nextAttemptAt)}`}
                  </p>
                </div>
                {(d.status === "failed" || d.status === "succeeded" || d.status === "no_endpoint") && (
                  <button onClick={() => resend(d.id)} className="text-xs font-medium text-brand-600 hover:underline">
                    Resend
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The publishable key only works for checkouts embedded on these sites (and localhost in development). */
function AllowedDomains() {
  const { merchant, setMerchant } = useDashboard();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const origins = merchant.allowedOrigins;

  async function save(next: string[], message: string) {
    setStatus(null);
    try {
      setMerchant((await api<{ merchant: Merchant }>("/api/merchant", { method: "PATCH", json: { allowedOrigins: next } })).merchant);
      setStatus({ tone: "success", text: message });
      return true;
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
      return false;
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    if (await save([...origins, value], `${value} can now embed your checkout.`)) setDraft("");
  }

  return (
    <Card
      title="Allowed domains"
      subtitle="Sites allowed to embed your checkout with @aevify/react and your publishable key. Browsers block every other site from framing it."
    >
      {origins.length > 0 ? (
        <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
          {origins.map((o) => (
            <li key={o} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 break-all font-mono text-sm">{o}</span>
              <button onClick={() => save(origins.filter((x) => x !== o), `${o} removed.`)} className="text-xs text-ink-muted hover:text-status-failed">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ink-muted">No domains yet. In development, http://localhost always works.</p>
      )}
      <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://your-store.com" className={inputClass} aria-label="Domain to allow" />
        <SecondaryButton type="submit" disabled={!draft.trim()}>
          Add domain
        </SecondaryButton>
      </form>
      {status && (
        <div className="mt-3">
          <Banner tone={status.tone}>{status.text}</Banner>
        </div>
      )}
    </Card>
  );
}
