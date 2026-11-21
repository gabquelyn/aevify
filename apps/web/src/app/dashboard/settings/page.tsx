"use client";

import { aevifyCheckoutAbi } from "@aevify/shared";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { api, formatDate, type Merchant } from "../_components/api";
import { useDashboard } from "../_components/shell";
import { Banner, Card, Field, inputClass, PageHeader, PrimaryButton, SecondaryButton, Spinner } from "../_components/ui";
import { useWalletAction } from "../_components/use-wallet";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <PayoutWallet />
        <Profile />
        <Account />
      </div>
    </>
  );
}

function PayoutWallet() {
  const { merchant, setMerchant, reloadMerchant, config } = useDashboard();
  const { status, setStatus, run, busy } = useWalletAction();
  const { onchain } = merchant;
  const explorer = config?.chain.explorerUrl;
  const changeDue = onchain.pendingPayoutEffectiveAt ? new Date(onchain.pendingPayoutEffectiveAt) <= new Date() : false;

  async function connectWallet() {
    await run(config?.chain ?? null, async ({ account, clients: { walletClient }, setLabel }) => {
      const challenge = await api<{ message: string }>("/api/merchant/payout-wallet/challenge", { method: "POST", json: { address: account } });
      setLabel("Sign the message in your wallet. It's free and doesn't send a transaction.");
      const signature = await walletClient.signMessage({ account, message: challenge.message });
      setLabel("Registering your wallet on Aevum…");
      const result = await api<{ merchant: Merchant; confirmed: boolean; notice?: string }>("/api/merchant/payout-wallet", {
        method: "POST",
        json: { address: account, signature },
      });
      setMerchant(result.merchant);
      setStatus({
        kind: "done",
        message: result.notice ?? (result.confirmed ? "Payout wallet connected and verified on Aevum." : "Submitted. It shows as verified once confirmed."),
      });
    });
  }

  async function applyChange() {
    setStatus({ kind: "busy", label: "Applying the change on Aevum…" });
    try {
      setMerchant((await api<{ merchant: Merchant }>("/api/merchant/payout-wallet/apply", { method: "POST" })).merchant);
      setStatus({ kind: "done", message: "Payout wallet updated." });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  /** The current payout wallet can cancel a pending change on-chain, e.g. if the account was compromised. */
  async function cancelChange() {
    if (!config) return;
    await run(
      config.chain,
      async ({ account, clients: { publicClient, walletClient }, setLabel }) => {
        const { request } = await publicClient.simulateContract({
          account,
          address: config.checkoutAddress,
          abi: aevifyCheckoutAbi,
          functionName: "cancelPayoutChange",
          args: [onchain.merchantId],
        });
        const hash = await walletClient.writeContract(request);
        setLabel("Confirming on Aevum…");
        await publicClient.waitForTransactionReceipt({ hash });
        await reloadMerchant();
      },
      { expectAccount: onchain.payoutAddress, successMessage: "Pending change cancelled." },
    );
  }

  return (
    <Card title="Payout wallet" subtitle="Payments settle straight to this wallet on Aevum, minus the 3% fee. Aevify never holds your funds.">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <WalletStatus status={onchain.status} />
          <p className="mt-2 break-all font-mono text-sm">{onchain.payoutAddress ?? "No wallet connected"}</p>
          {onchain.lastTxHash && explorer && (
            <a href={`${explorer}/tx/${onchain.lastTxHash}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
              View last transaction
            </a>
          )}
        </div>
        <PrimaryButton onClick={connectWallet} disabled={busy || onchain.status === "pending" || Boolean(onchain.pendingPayoutAddress)}>
          {onchain.payoutAddress ? "Change wallet" : "Connect wallet"}
        </PrimaryButton>
      </div>

      {onchain.pendingPayoutAddress && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Payout wallet change pending</p>
          <p className="mt-1">
            Changing to <span className="break-all font-mono text-xs">{onchain.pendingPayoutAddress}</span>{" "}
            {changeDue ? "— ready to apply." : `after ${formatDate(onchain.pendingPayoutEffectiveAt)}.`}
          </p>
          <p className="mt-1 text-xs">For your security there&apos;s a 24-hour delay. If you didn&apos;t request this, cancel it with your current wallet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {changeDue && (
              <PrimaryButton size="sm" onClick={applyChange} disabled={busy}>
                Apply change
              </PrimaryButton>
            )}
            <SecondaryButton size="sm" onClick={cancelChange} disabled={busy}>
              Cancel with current wallet
            </SecondaryButton>
          </div>
        </div>
      )}

      {!onchain.payoutAddress && (
        <p className="mt-4 text-sm text-ink-muted">
          You&apos;ll sign a free message to prove you own the wallet, so a typo can&apos;t send your money to someone else. Make sure your
          wallet is set up for {config?.chain.name ?? "Aevum"}.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {status.kind === "busy" && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> {status.label}
          </p>
        )}
        {status.kind === "error" && <Banner tone="error">{status.message}</Banner>}
        {status.kind === "done" && <Banner tone="success">{status.message}</Banner>}
      </div>
    </Card>
  );
}

function WalletStatus({ status }: { status: Merchant["onchain"]["status"] }) {
  const map = {
    registered: ["Verified on Aevum", "border-green-200 bg-green-50 text-status-paid"],
    pending: ["Confirming on Aevum", "border-amber-200 bg-amber-50 text-status-pending"],
    not_registered: ["Not connected", "border-line bg-surface-muted text-ink-muted"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function Profile() {
  const { merchant, setMerchant } = useDashboard();
  const [name, setName] = useState(merchant.name);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMerchant((await api<{ merchant: Merchant }>("/api/merchant", { method: "PATCH", json: { name } })).merchant);
      setStatus({ tone: "success", text: "Saved." });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error).message });
    }
  }

  return (
    <Card title="Business">
      <form onSubmit={save} className="space-y-4">
        <Field label="Business name" hint="Shown to customers at checkout.">
          <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Merchant ID" hint="Your permanent identifier on the Aevify contract.">
          <input value={merchant.slug} readOnly disabled className={`${inputClass} font-mono text-xs`} />
        </Field>
        <div className="flex items-center gap-3">
          <SecondaryButton type="submit" disabled={name === merchant.name}>
            Save
          </SecondaryButton>
          {status && <span className={`text-sm ${status.tone === "error" ? "text-status-failed" : "text-ink-muted"}`}>{status.text}</span>}
        </div>
      </form>
    </Card>
  );
}

function Account() {
  const { email } = useDashboard();
  return (
    <Card title="Account">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm">{email}</p>
          <p className="text-xs text-ink-muted">Signed in with Google or an email link.</p>
        </div>
        <SecondaryButton
          onClick={async () => {
            await authClient.signOut().catch(() => undefined);
            window.location.href = "/";
          }}
        >
          Sign out
        </SecondaryButton>
      </div>
    </Card>
  );
}
