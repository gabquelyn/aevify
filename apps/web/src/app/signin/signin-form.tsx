"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/dashboard" });
    setState(error ? { kind: "error", message: error.message ?? "Couldn't send the link." } : { kind: "sent", email });
  }

  async function google() {
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" });
    if (error) setState({ kind: "error", message: error.message ?? "Google sign-in failed." });
  }

  if (state.kind === "sent") {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="font-medium">Check your inbox</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          We sent a sign-in link to <span className="text-ink">{state.email}</span>. It expires in 10 minutes.
        </p>
        <button onClick={() => setState({ kind: "idle" })} className="mt-4 text-sm text-brand-600 hover:underline">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {googleEnabled && (
        <>
          <button
            onClick={google}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-ink-faint"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form onSubmit={sendLink} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Work email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@store.com"
            className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-faint focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
          />
        </label>
        <button
          type="submit"
          disabled={state.kind === "sending"}
          className="w-full rounded-full bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {state.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {state.kind === "error" && <p className="text-sm text-status-failed">{state.message}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}
