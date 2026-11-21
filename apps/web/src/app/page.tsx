import Link from "next/link";
import { FEE_BPS } from "@aevify/shared";
import { Hero } from "@/components/hero";
import { Logo } from "@/components/logo";
import { SiteHeader } from "@/components/site-header";

const STEPS = [
  {
    step: "01",
    title: "Create a payment request",
    body: "Your server calls the Aevify API with your secret key: amount, order ID, expiry. We sign it so the amount can't be changed.",
    meta: ["@aevify/node", "Server-side"],
  },
  {
    step: "02",
    title: "Customer pays in the checkout",
    body: "Drop in the Pay button. Customers see your verified name, connect a wallet and confirm. No addresses to copy, no amounts to type.",
    meta: ["@aevify/react", "Wallet"],
  },
  {
    step: "03",
    title: "Settled on Aevum, confirmed by webhook",
    body: "The checkout contract pays you instantly, minus the fee. Your server gets a signed webhook and fulfils the order.",
    meta: ["tUSD8", "Signed webhook"],
  },
];

const AGENT_RULES = [
  { label: "Per payment", value: "≤ 5 tUSD8" },
  { label: "Daily budget", value: "10 tUSD8" },
  { label: "Merchants", value: "Verified only" },
  { label: "Above limit", value: "Ask a human" },
];

export default function HomePage() {
  const feePercent = FEE_BPS / 100;

  return (
    <>
      <SiteHeader />
      <main>
        <Hero />

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-24">
          <p className="font-mono text-xs uppercase tracking-widest text-brand-600">How it works</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-medium tracking-tight sm:text-4xl">
            One flow, from button to settlement
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <article
                key={s.step}
                className="group rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
              >
                <span className="font-mono text-xs text-ink-faint">{s.step}</span>
                <h3 className="mt-6 text-lg font-medium tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {s.meta.map((m) => (
                    <span
                      key={m}
                      className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 font-mono text-[11px] text-ink-muted"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* AI agents */}
        <section id="agents" className="scroll-mt-20 border-y border-line bg-surface-muted">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-24 md:grid-cols-2 md:items-center">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-brand-600">AI agents</p>
              <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
                Agents pay the same checkout, within limits
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-ink-muted">
                An agent reads the payment request, checks it against its spending policy and pays from its own
                wallet. Your store gets the same webhook, labelled as an agent payment. Aevify never holds an
                agent&apos;s keys or funds.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {AGENT_RULES.map((r) => (
                <div key={r.label} className="bg-surface p-6">
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">{r.label}</dt>
                  <dd className="mt-2 text-xl font-medium tracking-tight">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-7xl px-6 py-24 text-center">
          <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">Start accepting tUSD8 today</h2>
          <p className="mx-auto mt-4 max-w-lg text-ink-muted">
            {feePercent}% per payment, capped in the contract. No setup fee. Testnet only during the Aevum Builder
            Challenge.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              Get API keys
            </Link>
            <Link
              href="/docs"
              className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium transition-colors hover:border-ink-faint"
            >
              Read the docs
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Built on QDay Aevum Testnet · Test tokens only</p>
        </div>
      </footer>
    </>
  );
}
