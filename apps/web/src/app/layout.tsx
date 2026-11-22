import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const title = "Aevify — Stablecoin checkout on Aevum";
const description =
  "Accept tUSD8 from customers and AI agents with a drop-in checkout. Settled on QDay Aevum, confirmed by webhook.";

/** Absolute base for link previews: the public app URL, else Vercel's production domain. */
function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL(configured || (vercel ? `https://${vercel}` : "http://localhost:3000"));
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title,
  description,
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    siteName: "Aevify",
    title,
    description,
    url: "/",
    // Regenerate with test-browser/og_image.py (renders /dev/og).
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Aevify: stablecoin checkout for every store" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-surface font-sans text-ink">{children}</body>
    </html>
  );
}
