import { NextResponse } from "next/server";
import { aevifyCheckoutAbi } from "@aevify/shared";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainContext, isChainConfigured } from "@/lib/chain";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { env } from "@/lib/env";

// Always run at request time; this checks live connections.
export const dynamic = "force-dynamic";

type Check = "ok" | "not_configured" | "invalid_key" | "error" | "mismatch";

async function checkDatabase(): Promise<{ status: Check; errorType?: string }> {
  if (!isDatabaseConfigured()) return { status: "not_configured" };
  try {
    await getDb().command({ ping: 1 });
    return { status: "ok" };
  } catch (error) {
    // Details go to the server log only; connection errors can include hostnames.
    console.error("[health] MongoDB ping failed:", error);
    return { status: "error", errorType: error instanceof Error ? error.name : "UnknownError" };
  }
}

/** Is the API's signer/operator key the one the deployed contract expects? */
async function checkRole(role: "signer" | "operator", readKey: () => string | undefined): Promise<Check> {
  let privateKey: string | undefined;
  try {
    privateKey = readKey();
  } catch {
    return "invalid_key";
  }
  if (!privateKey || !isChainConfigured()) return "not_configured";
  try {
    const { publicClient, checkoutAddress } = getChainContext();
    const expected = await publicClient.readContract({ address: checkoutAddress, abi: aevifyCheckoutAbi, functionName: role });
    const ours = privateKeyToAccount(privateKey as `0x${string}`).address;
    return getAddress(expected) === ours ? "ok" : "mismatch";
  } catch (error) {
    console.error(`[health] Couldn't check the ${role} role:`, error);
    return "error";
  }
}

/**
 * GET /api/health
 * Checks MongoDB, and that the API's signing/operator keys match the deployed contract.
 * Useful right after configuring .env, and for uptime checks once deployed.
 */
export async function GET() {
  const [database, signer, operator] = await Promise.all([
    checkDatabase(),
    checkRole("signer", env.signerPrivateKey),
    checkRole("operator", env.operatorPrivateKey),
  ]);
  const ok = database.status === "ok" && signer === "ok" && operator === "ok";

  return NextResponse.json(
    {
      service: "aevify-web",
      status: ok ? "ok" : "degraded",
      database: database.status === "ok" ? "connected" : database.status,
      ...(database.errorType ? { databaseErrorType: database.errorType } : {}),
      chain: {
        chainId: env.chainId(),
        checkoutContract: env.checkoutAddress() ?? null,
        signer,
        operator,
      },
      hints: [
        database.status === "not_configured" && "Set MONGODB_URI in .env.",
        database.status === "error" && "Check MONGODB_URI's user, password and host, and Atlas Network Access.",
        !isChainConfigured() && "Set AEVUM_RPC_URL and AEVIFY_CHECKOUT_ADDRESS (after deploying the contract).",
        signer === "not_configured" && "Set AEVIFY_SIGNER_PRIVATE_KEY.",
        signer === "mismatch" && "AEVIFY_SIGNER_PRIVATE_KEY isn't the contract's signer. Use the right key, or run ACTION=set-signer.",
        operator === "not_configured" && "Set AEVIFY_OPERATOR_PRIVATE_KEY.",
        signer === "invalid_key" && "AEVIFY_SIGNER_PRIVATE_KEY isn't a private key (64 hex characters, with or without 0x).",
        operator === "invalid_key" && "AEVIFY_OPERATOR_PRIVATE_KEY isn't a private key (64 hex characters, with or without 0x).",
        (signer === "error" || operator === "error") && "Couldn't read the contract's roles. Check AEVUM_RPC_URL and AEVIFY_CHECKOUT_ADDRESS; details are in the server log.",
        operator === "mismatch" && "AEVIFY_OPERATOR_PRIVATE_KEY isn't the contract's operator. Use the right key, or run ACTION=set-operator.",
      ].filter(Boolean),
    },
    { status: database.status === "ok" ? 200 : 503 },
  );
}
