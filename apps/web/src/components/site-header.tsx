import Link from "next/link";
import { Logo } from "./logo";

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#agents", label: "AI agents" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <Link href="/" aria-label="Aevify home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-ink-muted md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="hidden text-sm text-ink-muted transition-colors hover:text-ink sm:block">
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            Get API keys
          </Link>
        </div>
      </div>
    </header>
  );
}
