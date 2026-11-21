import { NextResponse } from "next/server";
import { AEVUM_TESTNET } from "@aevify/shared";
import { getDb, isDatabaseConfigured } from "@/lib/db";

// Always run at request time; this checks live connections.
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Reports whether the app can reach MongoDB. Useful right after setting MONGODB_URI,
 * and for uptime checks once deployed.
 */
export async function GET() {
  const base = {
    service: "aevify-web",
    chainId: AEVUM_TESTNET.id,
    checkoutContract: process.env.AEVIFY_CHECKOUT_ADDRESS ?? null,
  };

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ...base, status: "degraded", database: "not_configured", hint: "Set MONGODB_URI in .env" },
      { status: 503 },
    );
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return NextResponse.json({ ...base, status: "ok", database: "connected", databaseName: db.databaseName });
  } catch (error) {
    // Log details on the server only; connection errors can include hostnames.
    console.error("[health] MongoDB ping failed:", error);
    return NextResponse.json(
      {
        ...base,
        status: "degraded",
        database: "error",
        errorType: error instanceof Error ? error.name : "UnknownError",
        hint: "Check the user, password and host in MONGODB_URI, and that your IP is allowed in Atlas Network Access.",
      },
      { status: 503 },
    );
  }
}
