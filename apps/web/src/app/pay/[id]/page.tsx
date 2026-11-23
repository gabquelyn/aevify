import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { isChainConfigured } from "@/lib/chain";
import { isDatabaseConfigured } from "@/lib/db";
import { checkEmbed } from "@/lib/embed";
import { findMerchantById } from "@/lib/merchants";
import { findPayment, serializeCheckout, syncPayment } from "@/lib/payments";
import { Checkout } from "./checkout";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Cached per request, so the page and its metadata share one set of database and chain reads. */
const loadPayment = cache(async function loadPayment(id: string) {
  if (!isDatabaseConfigured() || !isChainConfigured()) return null;
  const payment = await findPayment(id);
  if (!payment) return undefined;
  const merchant = await findMerchantById(payment.merchantId);
  if (!merchant) return undefined;
  return { payment, merchant };
});

const loadCheckout = cache(async function loadCheckout(id: string) {
  const found = await loadPayment(id);
  if (!found) return found;
  return serializeCheckout(await syncPayment(found.payment), found.merchant);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadCheckout((await params).id).catch(() => null);
  return {
    title: data ? `Pay ${data.merchant.name} · Aevify` : "Checkout · Aevify",
    robots: { index: false, follow: false },
  };
}

/** The hosted checkout: where `checkoutUrl` sends customers, and what @aevify/react embeds. */
export default async function PayPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const embed = query.embed === "1";
  let found: Awaited<ReturnType<typeof loadPayment>>;
  try {
    found = await loadPayment(id);
  } catch (error) {
    console.error("[pay] Couldn't load payment", id, error);
    return <Unavailable embed={embed} />;
  }
  if (found === undefined) notFound();

  // Embedded (by @aevify/react): the publishable key must match and the parent site must be allowed.
  let parentOrigin: string | null = null;
  if (embed && found) {
    const check = await checkEmbed(found.merchant, typeof query.pk === "string" ? query.pk : undefined, typeof query.origin === "string" ? query.origin : undefined);
    if (!check.ok) return <EmbedRefused reason={check.reason} />;
    parentOrigin = check.origin;
  }

  let data: Awaited<ReturnType<typeof loadCheckout>> = null;
  try {
    data = found ? await loadCheckout(id) : null;
  } catch (error) {
    // e.g. the RPC is down: show a calm page instead of a server error.
    console.error("[pay] Couldn't prepare checkout", id, error);
  }
  if (!data) return <Unavailable embed={embed} />;
  return <Checkout initial={data} embed={embed} parentOrigin={parentOrigin} />;
}

/** Shown when the database or chain can't be reached. In a modal, tells @aevify/react to fall back at once. */
function Unavailable({ embed }: { embed: boolean }) {
  const script = `window.parent!==window&&window.parent.postMessage(${JSON.stringify({ source: "aevify", type: "error", reason: "unavailable" })},"*")`;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="font-medium">Checkout is busy right now</p>
        <p className="mt-2 text-sm text-ink-muted">We couldn&apos;t reach the network. Nothing has been charged.</p>
        <a href="" className="mt-5 inline-flex rounded-full bg-ink px-5 py-2 text-sm font-medium text-white">
          Try again
        </a>
      </div>
      {embed && <script dangerouslySetInnerHTML={{ __html: script }} />}
    </main>
  );
}

const REFUSED: Record<string, string> = {
  invalid_publishable_key: "The publishable key doesn't belong to this store. Check the key passed to @aevify/react.",
  origin_not_allowed: "This site isn't in the store's allowed domains. Add it in the Aevify dashboard under Developers → Allowed domains.",
};

function EmbedRefused({ reason }: { reason: string }) {
  // Tell the parent page why (no payment details), so @aevify/react can fall back to a new tab.
  const script = `window.parent!==window&&window.parent.postMessage(${JSON.stringify({ source: "aevify", type: "error", reason })},"*")`;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="font-medium">This checkout can&apos;t be shown here</p>
        <p className="mt-2 text-sm text-ink-muted">{REFUSED[reason] ?? "Embedding isn't allowed."}</p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </main>
  );
}
