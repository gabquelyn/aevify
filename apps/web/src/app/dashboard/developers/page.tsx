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
        <Webhooks />
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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="font-mono text-xs">{show ? merchant.webhookSecret : "whsec_••••••••••••••••••••"}</code>
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
        The response includes <code className="font-mono text-xs">checkoutUrl</code>. Full reference: <code className="font-mono text-xs">docs/API.md</code>.
      </p>
    </Card>
  );
}
