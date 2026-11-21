/**
 * Stored records and their public JSON shapes. Shared by the web API (which creates and
 * returns payments), the listener (which updates them from the chain) and webhook events
 * (which carry the same payment object the API returns).
 *
 * No runtime dependencies, so the published SDKs can bundle these types safely.
 */
import { fromBaseUnits } from "./constants.ts";

type Hex = `0x${string}`;

export type PaymentStatus = "created" | "paid" | "expired" | "refunded";

/** A payment as stored in MongoDB (collection `payments`). */
export type PaymentDoc = {
  _id: string;
  merchantId: string;
  onchainPaymentId: Hex;
  onchainMerchantId: Hex;
  /** Base units (tUSD8 has 6 decimals), as a string to keep full precision. */
  amount: string;
  decimals: number;
  currency: string;
  orderId: string | null;
  description: string | null;
  metadata: Record<string, string>;
  /** If set, only this address may pay (e.g. a specific AI agent's wallet). */
  payer: Hex | null;
  status: PaymentStatus;
  expiresAt: Date;
  signature: Hex;
  successUrl: string | null;
  cancelUrl: string | null;
  idempotencyKey: string | null;
  requestHash: string;
  createdBlock: string | null;
  paidBy: Hex | null;
  paidAt: Date | null;
  fee: string | null;
  refunded: string;
  txHash: Hex | null;
  createdAt: Date;
  updatedAt: Date;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;
const display = (units: string | null, decimals: number) => (units === null ? null : fromBaseUnits(BigInt(units), decimals));

/** The public payment object: returned by the API and carried in webhook events. */
export function serializePayment(doc: PaymentDoc, appUrl: string) {
  return {
    id: doc._id,
    object: "payment" as const,
    status: doc.status,
    amount: display(doc.amount, doc.decimals) as string,
    amountBaseUnits: doc.amount,
    currency: doc.currency,
    fee: display(doc.fee, doc.decimals),
    refunded: display(doc.refunded, doc.decimals) as string,
    orderId: doc.orderId,
    description: doc.description,
    metadata: doc.metadata,
    payer: doc.payer,
    paidBy: doc.paidBy,
    txHash: doc.txHash,
    checkoutUrl: `${appUrl.replace(/\/$/, "")}/pay/${doc._id}`,
    onchain: { paymentId: doc.onchainPaymentId, merchantId: doc.onchainMerchantId },
    successUrl: doc.successUrl,
    cancelUrl: doc.cancelUrl,
    expiresAt: iso(doc.expiresAt) as string,
    paidAt: iso(doc.paidAt),
    createdAt: iso(doc.createdAt) as string,
    livemode: false as const,
  };
}

export type PaymentObject = ReturnType<typeof serializePayment>;
