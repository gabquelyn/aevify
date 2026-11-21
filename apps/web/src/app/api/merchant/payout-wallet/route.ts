import { NextResponse } from "next/server";
import { getAddress, isAddress, isHex, type Hex } from "viem";
import { z } from "zod";
import { requireSessionMerchant } from "@/lib/api-auth";
import {
  ChainNotConfiguredError,
  registerMerchantOnChain,
  requestPayoutChangeOnChain,
  verifyWalletSignature,
} from "@/lib/chain";
import { apiError, handle, readJson, validationError } from "@/lib/http";
import { serializeMerchant, syncMerchantFromChain, updateMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

const PAYOUT_CHANGE_DELAY_MS = 24 * 60 * 60 * 1000; // matches AevifyCheckout.PAYOUT_CHANGE_DELAY

/**
 * POST /api/merchant/payout-wallet { address, signature }
 * Step 2: verify the signed challenge, then on-chain:
 *  - first wallet: register the merchant (takes effect immediately)
 *  - later changes: request a payout change (takes effect after 24 hours; the current
 *    payout wallet can cancel it on-chain)
 */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const merchant = await syncMerchantFromChain(auth.merchant);

  const parsed = z
    .object({
      address: z.string().refine((v) => isAddress(v), "must be a valid 0x address"),
      signature: z.string().refine((v) => isHex(v), "must be a 0x hex signature"),
    })
    .strict()
    .safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const address = getAddress(parsed.data.address);
  const challenge = merchant.payoutChallenge;
  if (!challenge || challenge.address !== address) {
    return apiError(400, "invalid_request", "Request a signing message for this wallet first.", "address");
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return apiError(400, "invalid_request", "The signing message expired. Request a new one.", "signature");
  }
  if (!(await verifyWalletSignature(address, challenge.message, parsed.data.signature as Hex))) {
    return apiError(400, "invalid_request", "The signature doesn't match this wallet.", "signature");
  }
  // One use per challenge.
  await updateMerchant(merchant._id, { payoutChallenge: null });

  if (merchant.onchainStatus === "pending") {
    return apiError(409, "conflict", "Your previous wallet registration is still confirming. Try again in a minute.");
  }
  if (merchant.payoutAddress === address) {
    return apiError(409, "conflict", "That's already your payout wallet.");
  }

  try {
    if (merchant.onchainStatus === "not_registered") {
      const tx = await registerMerchantOnChain(merchant.onchainMerchantId, address);
      const updated = await updateMerchant(merchant._id, {
        onchainStatus: tx.confirmed ? "registered" : "pending",
        payoutAddress: address,
        lastTxHash: tx.hash,
      });
      return NextResponse.json({ merchant: serializeMerchant(updated ?? merchant), txHash: tx.hash, confirmed: tx.confirmed });
    }

    const tx = await requestPayoutChangeOnChain(merchant.onchainMerchantId, address);
    const updated = await updateMerchant(merchant._id, {
      pendingPayoutAddress: address,
      pendingPayoutEffectiveAt: new Date(Date.now() + PAYOUT_CHANGE_DELAY_MS),
      lastTxHash: tx.hash,
    });
    return NextResponse.json({
      merchant: serializeMerchant(updated ?? merchant),
      txHash: tx.hash,
      confirmed: tx.confirmed,
      notice: "For your security, the new payout wallet takes effect in 24 hours. Your current wallet can cancel it.",
    });
  } catch (error) {
    if (error instanceof ChainNotConfiguredError) throw error;
    console.error("[payout-wallet] On-chain update failed:", error);
    return apiError(502, "chain_error", "Couldn't update your payout wallet on Aevum. Please try again.");
  }
});
