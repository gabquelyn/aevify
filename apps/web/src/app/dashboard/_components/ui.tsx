"use client";

import { useState } from "react";
import type { PaymentStatus } from "./api";

export const inputClass =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-faint focus:border-brand-400 focus:ring-4 focus:ring-brand-100 disabled:bg-surface-muted";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-medium tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "md" };

export function PrimaryButton({ size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`shrink-0 rounded-full bg-brand-500 font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${className}`}
    />
  );
}

export function SecondaryButton({ size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`shrink-0 rounded-full border border-line-strong bg-surface font-medium transition-colors hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${className}`}
    />
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "error" | "warn" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "border-brand-200 bg-brand-50 text-brand-700",
    error: "border-red-200 bg-red-50 text-red-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-green-200 bg-green-50 text-green-800",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

const STATUS: Record<PaymentStatus, { label: string; className: string }> = {
  created: { label: "Awaiting payment", className: "border-amber-200 bg-amber-50 text-status-pending" },
  paid: { label: "Paid", className: "border-green-200 bg-green-50 text-status-paid" },
  refunded: { label: "Refunded", className: "border-brand-200 bg-brand-50 text-brand-700" },
  expired: { label: "Expired", className: "border-line bg-surface-muted text-ink-muted" },
};

export function StatusBadge({ status, partialRefund }: { status: PaymentStatus; partialRefund?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>
      {partialRefund && status === "paid" ? "Partially refunded" : s.label}
    </span>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-brand-200 border-t-brand-500 ${className}`} aria-hidden="true" />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-medium">{title}</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
