import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { requireSessionMerchant } from "@/lib/api-auth";
import { handle, readJson, validationError } from "@/lib/http";
import { newSecret } from "@/lib/ids";
import { updateMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * POST /api/merchant/payout-wallet/challenge { address }
 * Step 1 of connecting a payout wallet: returns a message for the wallet to sign, proving
 * the merchant controls it (so a typo can't send their money to someone else).
 */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;

  const parsed = z
    .object({ address: z.string().refine((v) => isAddress(v), "must be a valid 0x address") })
    .strict()
    .safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const address = getAddress(parsed.data.address);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = [
    "Aevify: confirm this wallet for payouts.",
    "",
    `Business: ${auth.merchant.name} (${auth.merchant.slug})`,
    `Wallet: ${address}`,
    `Nonce: ${newSecret.nonce()}`,
    `Issued at: ${issuedAt.toISOString()}`,
    `Expires at: ${expiresAt.toISOString()}`,
    "",
    "Signing is free and doesn't send a transaction.",
  ].join("\n");

  await updateMerchant(auth.merchant._id, { payoutChallenge: { address, message, expiresAt } });
  return NextResponse.json({ address, message, expiresAt: expiresAt.toISOString() });
});
