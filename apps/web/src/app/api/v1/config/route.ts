import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { publicCheckoutConfig } from "@/lib/public-config";

export const dynamic = "force-dynamic";

/** GET /api/v1/config: public chain, contract and token details for wallets and SDKs. */
export const GET = handle(async () => {
  return NextResponse.json(await publicCheckoutConfig(), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" },
  });
});
