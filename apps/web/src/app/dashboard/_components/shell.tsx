"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { api, type Merchant, type PublicConfig } from "./api";
import { Banner, Card, Field, inputClass, PrimaryButton, Spinner } from "./ui";

type DashboardContext = {
  email: string;
  merchant: Merchant;
  setMerchant: (m: Merchant) => void;
  reloadMerchant: () => Promise<void>;
  config: PublicConfig | null;
};

const Ctx = createContext<DashboardContext | null>(null);

export function useDashboard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardShell");
  return ctx;
}

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "M3 12h4v8H3zM10 4h4v16h-4zM17 9h4v11h-4z" },
  { href: "/dashboard/payments", label: "Payments", icon: "M3 6h18v12H3zM3 10h18M7 15h3" },
  { href: "/dashboard/developers", label: "Developers", icon: "M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12" },
  { href: "/dashboard/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2" },
];

export function DashboardShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant | null | undefined>(undefined);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const reloadMerchant = useCallback(async () => {
    try {
      setMerchant((await api<{ merchant: Merchant | null }>("/api/merchant")).merchant);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reloadMerchant();
    api<PublicConfig>("/api/v1/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [reloadMerchant]);

  async function signOut() {
    await authClient.signOut().catch(() => undefined);
    router.push("/");
  }

  const isActive = (href: string) => (href === "/dashboard" ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-dvh bg-surface-muted lg:grid lg:grid-cols-[232px_1fr]">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center justify-between px-5 lg:h-16">
          <Link href="/" aria-label="Aevify home">
            <Logo />
          </Link>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink-muted">Testnet</span>
        </div>
        {merchant && (
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0 lg:pt-2" aria-label="Dashboard">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive(item.href) ? "bg-brand-50 font-medium text-brand-700" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="hidden size-4 lg:block" aria-hidden="true">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="mt-auto hidden border-t border-line px-5 py-4 lg:block">
          {merchant && <p className="truncate text-sm font-medium">{merchant.name}</p>}
          <p className="truncate text-xs text-ink-muted">{email}</p>
          <button onClick={signOut} className="mt-2 text-xs text-ink-muted hover:text-ink">
            Sign out
          </button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-5 py-8 lg:px-10 lg:py-10">
        {error && <Banner tone="error">{error}</Banner>}
        {merchant === undefined && !error && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading…
          </div>
        )}
        {merchant === null && <Onboarding onCreated={setMerchant} />}
        {merchant && (
          <Ctx.Provider value={{ email, merchant, setMerchant, reloadMerchant, config }}>
            {!merchant.readyForPayments && !pathname.startsWith("/dashboard/settings") && (
              <div className="mb-6">
                <Banner tone="info">
                  {merchant.onchain.status === "pending"
                    ? "Your payout wallet is confirming on Aevum. Payments open once it's verified."
                    : "Connect a payout wallet to start accepting payments."}{" "}
                  <Link href="/dashboard/settings" className="font-medium underline">
                    Go to settings
                  </Link>
                </Banner>
              </div>
            )}
            {children}
          </Ctx.Provider>
        )}
      </main>
    </div>
  );
}

function Onboarding({ onCreated }: { onCreated: (m: Merchant) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated((await api<{ merchant: Merchant }>("/api/merchant", { method: "POST", json: { name } })).merchant);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-8">
      <p className="font-mono text-xs uppercase tracking-widest text-brand-600">Welcome</p>
      <h1 className="mt-2 text-2xl font-medium tracking-tight">Set up your business</h1>
      <p className="mt-1 text-sm text-ink-muted">Customers see this name at checkout. You can change it later.</p>
      <Card className="mt-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Business name">
            <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo Store" className={inputClass} autoFocus />
          </Field>
          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Continue"}
          </PrimaryButton>
          {error && <p className="text-sm text-status-failed">{error}</p>}
        </form>
      </Card>
    </div>
  );
}
