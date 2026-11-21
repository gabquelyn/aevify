import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { DashboardShell } from "./_components/shell";

export const metadata: Metadata = { title: "Dashboard · Aevify", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/signin");
  return <DashboardShell email={user.email}>{children}</DashboardShell>;
}
