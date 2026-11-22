import { notFound } from "next/navigation";
import { AsciiMark } from "@/components/ascii-mark";
import { LogoMark } from "@/components/logo";
import { isMemoryTestMode } from "@/lib/db";

/**
 * DEV ONLY (memory test mode): the 1200×630 social card, built from the hero's own pieces.
 * Captured to public/og.png by test-browser/og_image.py. 404 otherwise.
 */
export default function OgCard() {
  if (!isMemoryTestMode()) notFound();
  return (
    <div id="og" className="relative isolate h-[630px] w-[1200px] overflow-hidden bg-surface">
      <div className="bg-dot-grid mask-fade-edges absolute inset-0 -z-20" aria-hidden="true" />
      <div className="mask-fade-left absolute bottom-0 right-2 top-0 -z-10 w-[58%]">
        <AsciiMark className="block" />
      </div>

      <div className="flex h-full flex-col justify-center px-[72px]">
        <p className="mb-8 inline-flex items-center gap-2.5 text-[22px] font-medium text-ink">
          <LogoMark className="size-6 text-brand-500" />
          Aevify
          <span className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[15px] font-normal text-ink-muted">
            Aevum Testnet
          </span>
        </p>

        <h1 className="text-[86px] font-medium leading-[1.02] tracking-tightest">
          <span className="text-gradient-ink">Stablecoin</span>
          <br />
          <span className="text-gradient-ink">checkout for</span>
          <br />
          <span className="text-gradient-ink">every store</span>
        </h1>

        <p className="mt-8 max-w-[560px] text-[24px] leading-snug text-ink-muted">
          Accept tUSD8 from customers and AI agents. Settled on Aevum, confirmed by webhook.
        </p>
      </div>
    </div>
  );
}
