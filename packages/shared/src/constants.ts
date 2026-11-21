/**
 * Shared types and constants for Aevify.
 * Used by the web app, the listener, and the published SDK packages.
 */

/** QDay Aevum Testnet. The RPC URL comes from the environment (see .env.example). */
export const AEVUM_TESTNET = {
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
} as const;

/** tUSD8: the challenge's test stablecoin. ERC-20 with 6 decimals (not 18). */
export const TUSD8 = {
  address: "0x456569838f1d43009A91ebA4263147Afd7233483",
  symbol: "tUSD8",
  decimals: 6,
} as const;

/** Aevify's fee in basis points (300 = 3%). The contract enforces a hard ceiling. */
export const FEE_BPS = 300;
export const MAX_FEE_BPS = 500;

/** Lifecycle of a payment request. */
export const PAYMENT_STATUSES = [
  "created", // request exists, nobody has paid yet
  "pending", // a payment transaction was seen but is not yet confirmed
  "paid", // confirmed on Aevum
  "expired", // nobody paid before the expiry time
  "refunded", // merchant refunded the payment on-chain
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Who paid: a person through the checkout, or an AI agent in code. */
export type PayerKind = "human" | "agent";

/** Events delivered to merchants as signed webhooks. */
export const WEBHOOK_EVENTS = [
  "payment.paid",
  "payment.expired",
  "payment.refunded",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Convert a human amount like "25.00" into tUSD8 base units (6 decimals). */
export function toBaseUnits(amount: string, decimals: number = TUSD8.decimals): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: "${amount}"`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

/** Convert tUSD8 base units back into a display string like "25.00". */
export function fromBaseUnits(value: bigint, decimals: number = TUSD8.decimals, minFraction = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fraction.padEnd(minFraction, "0")}`;
}
