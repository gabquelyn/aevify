"use client";

import type { WalletInfo } from "@/lib/client/wallet";
import { Banner, Spinner } from "./ui";
import type { WalletStatus } from "./use-wallet";

/** Status line for wallet actions: wallet picker, progress (with help if it's slow), result. */
export function WalletStatusView({
  status,
  onPick,
  onReset,
}: {
  status: WalletStatus;
  onPick: (wallet: WalletInfo | null) => void;
  onReset: () => void;
}) {
  if (status.kind === "choose") {
    return (
      <div className="rounded-xl border border-line bg-surface-muted p-3" data-testid="wallet-picker">
        <p className="mb-2 text-sm font-medium text-ink">Which wallet?</p>
        <div className="grid gap-2">
          {status.wallets.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onPick(w)}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm font-medium text-ink hover:border-brand-300"
            >
              {/* Icons are data: URIs announced by the extension (EIP-6963). */}
              {w.icon ? <img src={w.icon} alt="" className="size-6 rounded" /> : <span className="size-6 rounded bg-line" />}
              {w.name}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onPick(null)} className="mt-2 text-xs text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    );
  }
  if (status.kind === "busy") {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {status.label}
        </p>
        {status.slow && (
          <div className="rounded-xl border border-line bg-surface-muted p-3 text-sm text-ink-muted">
            <p className="font-medium text-ink">No pop-up?</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Click the wallet&apos;s icon in your browser toolbar. The request may be waiting there, or the wallet may be locked.</li>
              <li>Approve or reject any older request still open in the wallet.</li>
              <li>Have several wallet extensions? Use another one.</li>
            </ul>
            <button type="button" onClick={onReset} className="mt-2 font-medium text-brand-700 hover:underline">
              Stop waiting and choose a wallet
            </button>
          </div>
        )}
      </div>
    );
  }
  if (status.kind === "error") return <Banner tone="error">{status.message}</Banner>;
  if (status.kind === "done") return <Banner tone="success">{status.message}</Banner>;
  return null;
}
