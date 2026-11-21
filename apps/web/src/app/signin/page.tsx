import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { isGoogleSignInEnabled } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { SignInForm } from "./signin-form";

export const metadata: Metadata = { title: "Sign in · Aevify" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const configured = isDatabaseConfigured();
  if (configured && (await getSessionUser(await headers()).catch(() => null))) redirect("/dashboard");

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="bg-dot-grid mask-fade-edges absolute inset-0 -z-10" aria-hidden="true" />
      <div className="w-full max-w-sm">
        <Link href="/" aria-label="Aevify home" className="mb-10 inline-block">
          <Logo />
        </Link>
        <h1 className="text-3xl font-medium tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Accept stablecoin payments on Aevum. New here? Signing in creates your account.
        </p>
        <div className="mt-8">
          {configured ? (
            <SignInForm googleEnabled={isGoogleSignInEnabled()} />
          ) : (
            <p className="rounded-xl border border-status-pending/30 bg-amber-50 p-4 text-sm text-amber-900">
              Sign-in isn&apos;t available yet: set <code className="font-mono">MONGODB_URI</code> in{" "}
              <code className="font-mono">.env</code> and restart the app.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
