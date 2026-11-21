import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isChainConfigured } from "@/lib/chain";
import { isDatabaseConfigured } from "@/lib/db";
import { findMerchantById } from "@/lib/merchants";
import { findPayment, serializeCheckout, syncPayment } from "@/lib/payments";
import { Checkout } from "./checkout";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(id: string) {
  if (!isDatabaseConfigured() || !isChainConfigured()) return null;
  const payment = await findPayment(id);
  if (!payment) return undefined;
  const merchant = await findMerchantById(payment.merchantId);
  if (!merchant) return undefined;
  return serializeCheckout(await syncPayment(payment), merchant);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).id).catch(() => null);
  return {
    title: data ? `Pay ${data.merchant.name} · Aevify` : "Checkout · Aevify",
    robots: { index: false, follow: false },
  };
}

/** The hosted checkout: where `checkoutUrl` sends customers, and what @aevify/react embeds. */
export default async function PayPage({ params, searchParams }: Props) {
  const { id } = await params;
  const embed = (await searchParams).embed === "1";
  const data = await load(id);
  if (data === undefined) notFound();
  if (data === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-ink-muted">Checkout is temporarily unavailable. Please try again shortly.</p>
      </main>
    );
  }
  return <Checkout initial={data} embed={embed} />;
}
