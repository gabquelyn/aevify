import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionMerchant } from "@/lib/api-auth";
import { countActiveKeys, createApiKey, listApiKeys, MAX_ACTIVE_SECRET_KEYS, serializeApiKey } from "@/lib/api-keys";
import { apiError, handle, readJson, validationError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/merchant/keys: all keys (secret keys only as previews). */
export const GET = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;
  const keys = await listApiKeys(auth.merchant._id);
  return NextResponse.json({ data: keys.map((k) => serializeApiKey(k)) });
});

/** POST /api/merchant/keys { kind }: create a key. A secret key's full value is returned only here. */
export const POST = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;

  const parsed = z
    .object({ kind: z.enum(["secret", "publishable"]).default("secret") })
    .strict()
    .safeParse((await readJson(request)) ?? {});
  if (!parsed.success) return validationError(parsed.error);

  const { kind } = parsed.data;
  if (kind === "secret" && (await countActiveKeys(auth.merchant._id, "secret")) >= MAX_ACTIVE_SECRET_KEYS) {
    return apiError(409, "conflict", `You can have at most ${MAX_ACTIVE_SECRET_KEYS} active secret keys. Revoke one first.`);
  }

  const { doc, plaintext } = await createApiKey(auth.merchant._id, kind);
  return NextResponse.json(
    {
      key: serializeApiKey(doc, plaintext),
      ...(kind === "secret" ? { notice: "Copy this secret key now. It won't be shown again." } : {}),
    },
    { status: 201 },
  );
});
