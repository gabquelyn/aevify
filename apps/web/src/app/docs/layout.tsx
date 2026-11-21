import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { DocsSidebar } from "./sidebar";

export const metadata: Metadata = {
  title: { template: "%s · Aevify docs", default: "Aevify docs" },
  description: "Accept stablecoin payments on QDay Aevum: checkout, API, SDKs, webhooks and AI agents.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-14">
        <aside className="lg:sticky lg:top-24 lg:h-[calc(100dvh-8rem)] lg:overflow-y-auto">
          <DocsSidebar />
        </aside>
        <article className="min-w-0 max-w-3xl pb-24">{children}</article>
      </div>
    </>
  );
}
