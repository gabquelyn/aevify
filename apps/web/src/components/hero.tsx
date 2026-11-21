import Link from "next/link";
import { AsciiMark } from "./ascii-mark";
import { LogoMark } from "./logo";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      {/* Fine dot grid that fades toward the edges */}
      <div className="bg-dot-grid mask-fade-edges absolute inset-0 -z-20" aria-hidden="true" />

      {/* Character-art "A": behind the text on mobile, beside it on desktop */}
      <div className="mask-fade-left absolute inset-y-0 right-0 -z-10 w-full opacity-[0.18] md:w-[62%] md:opacity-100">
        <AsciiMark className="block" />
      </div>

      <div className="mx-auto flex min-h-[560px] max-w-7xl flex-col justify-center px-6 py-24 md:min-h-[640px]">
        <div className="max-w-xl">
          <p className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-ink">
            <LogoMark className="size-4 text-brand-500" />
            Aevify
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] font-normal text-ink-muted">
              Aevum Testnet
            </span>
          </p>

          <h1 className="text-5xl font-medium leading-[1.02] tracking-tightest sm:text-6xl lg:text-7xl">
            <span className="text-gradient-ink">Stablecoin</span>
            <br />
            <span className="text-gradient-ink">checkout for</span>
            <br />
            <span className="text-gradient-ink">every store</span>
          </h1>

          <p className="mt-7 max-w-md text-[17px] leading-relaxed text-ink-muted">
            Accept tUSD8 from customers and AI agents with a drop-in checkout. Settled on Aevum,
            confirmed by webhook, no wallet addresses in sight.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-brand-500/20 transition-colors hover:bg-brand-600"
            >
              Get API keys
            </Link>
            <Link
              href="/docs"
              className="rounded-full border border-line-strong bg-surface/70 px-5 py-2.5 text-sm font-medium text-ink backdrop-blur transition-colors hover:border-ink-faint"
            >
              View docs
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
