import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Dashboard · Aevify" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/signin");
  return <Dashboard email={user.email} />;
}
