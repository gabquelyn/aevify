import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aevify — Stablecoin checkout on Aevum",
  description:
    "Accept tUSD8 from customers and AI agents with a drop-in checkout. Settled on QDay Aevum, confirmed by webhook.",
  icons: { icon: "/favicon.svg" },
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
