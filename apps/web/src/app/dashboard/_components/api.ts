"use client";

import type { PublicChain } from "@/lib/client/wallet";

/** Shapes returned by the dashboard API (see docs/API.md). */

export type Merchant = {
  id: string;
  name: string;
  slug: string;
  onchain: {
    merchantId: `0x${string}`;
    status: "not_registered" | "pending" | "registered";
    payoutAddress: `0x${string}` | null;
    pendingPayoutAddress: `0x${string}` | null;
    pendingPayoutEffectiveAt: string | null;
    lastTxHash: string | null;
  };
  webhookUrl: string | null;
  webhookSecret: string;
  readyForPayments: boolean;
  createdAt: string;
};

export type ApiKey = {
  id: string;
  kind: "secret" | "publishable";
  key: string | null;
  preview: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type PaymentStatus = "created" | "paid" | "expired" | "refunded";

export type Payment = {
  id: string;
  status: PaymentStatus;
  amount: string;
  amountBaseUnits: string;
  currency: string;
  fee: string | null;
  refunded: string;
  orderId: string | null;
  description: string | null;
  metadata: Record<string, string>;
  payer: string | null;
  paidBy: string | null;
  txHash: string | null;
  checkoutUrl: string;
  onchain: { paymentId: `0x${string}`; merchantId: `0x${string}` };
  successUrl: string | null;
  cancelUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
};

export type Stats = {
  currency: string;
  volume: string;
  fees: string;
  refunded: string;
  net: string;
  counts: Record<PaymentStatus, number>;
  daily: { date: string; volume: string; count: number }[];
};

export type PublicConfig = {
  chain: PublicChain;
  checkoutAddress: `0x${string}`;
  token: { address: `0x${string}`; symbol: string; decimals: number };
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public type?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    cache: "no-store",
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.type);
  return body as T;
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const formatAmount = (value: string | null) =>
  value === null ? "—" : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
