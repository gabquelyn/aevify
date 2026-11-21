import { NextResponse } from "next/server";
import { requireSessionMerchant } from "@/lib/api-auth";
import { applyPayoutChangeOnChain, ChainNotConfiguredError, chainTime } from "@/lib/chain";
import { apiError, handle } from "@/lib/http";
import { findMerchantById, serializeMerchant, syncMerchantFromChain, updateMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

/** POST /api/merchant/payout-wallet/apply: finish a payout change once its 24-hour delay has passed. */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const merchant = await syncMerchantFromChain(auth.merchant);

  if (!merchant.pendingPayoutAddress || !merchant.pendingPayoutEffectiveAt) {
    return apiError(409, "conflict", "There's no pending payout wallet change.");
  }
  // The contract enforces the delay with block time, so compare against that.
  if (merchant.pendingPayoutEffectiveAt.getTime() > (await chainTime()).getTime()) {
    return apiError(409, "conflict", `The change can be applied after ${merchant.pendingPayoutEffectiveAt.toISOString()}.`);
  }

  try {
    const tx = await applyPayoutChangeOnChain(merchant.onchainMerchantId);
    await updateMerchant(merchant._id, { lastTxHash: tx.hash });
    const fresh = await findMerchantById(merchant._id);
    const synced = fresh ? await syncMerchantFromChain(fresh) : merchant;
    return NextResponse.json({ merchant: serializeMerchant(synced), txHash: tx.hash, confirmed: tx.confirmed });
  } catch (error) {
    if (error instanceof ChainNotConfiguredError) throw error;
    console.error("[payout-wallet/apply] On-chain update failed:", error);
    return apiError(502, "chain_error", "Couldn't apply the payout change on Aevum. Please try again.");
  }
});
