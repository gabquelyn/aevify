import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireSessionMerchant } from "@/lib/api-auth";
import { createApiKey } from "@/lib/api-keys";
import { env } from "@/lib/env";
import { apiError, handle, readJson, validationError } from "@/lib/http";
import { normalizeOrigin } from "@/lib/embed";
import { createMerchant, serializeMerchant, syncMerchantFromChain, updateMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

/** GET /api/merchant: the signed-in user and their business (null until created). */
export const GET = handle(async (request: Request) => {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  const merchant = auth.merchant ? await syncMerchantFromChain(auth.merchant) : null;
  return NextResponse.json({ user: auth.user, merchant: merchant ? serializeMerchant(merchant) : null });
});

const nameSchema = z.string().trim().min(2, "must be at least 2 characters").max(80);

/** POST /api/merchant { name }: create the business profile (one per user) and a publishable key. */
export const POST = handle(async (request: Request) => {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  if (auth.merchant) return apiError(409, "conflict", "You already have a business profile.");

  const parsed = z.object({ name: nameSchema }).strict().safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const merchant = await createMerchant(auth.user.id, parsed.data.name);
  await createApiKey(merchant._id, "publishable");
  return NextResponse.json({ merchant: serializeMerchant(merchant) }, { status: 201 });
});

const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    // Plain http only for local development.
    return !env.isProduction() && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  }, "must be an https:// URL (http://localhost is allowed in development)");

const allowedOriginsSchema = z
  .array(z.string().max(200))
  .max(10, "at most 10 domains")
  .transform((list, ctx) => {
    const out: string[] = [];
    for (const item of list) {
      const origin = normalizeOrigin(item);
      if (!origin) {
        ctx.addIssue({ code: "custom", message: `"${item}" isn't a valid origin. Use https://your-store.com (http only for localhost).` });
        return z.NEVER;
      }
      if (!out.includes(origin)) out.push(origin);
    }
    return out;
  });

/** PATCH /api/merchant { name?, webhookUrl?, allowedOrigins? }: update the business profile. */
export const PATCH = handle(async (request: Request) => {
  const auth = await requireSessionMerchant(request);
  if (auth instanceof Response) return auth;

  const parsed = z
    .object({ name: nameSchema.optional(), webhookUrl: webhookUrlSchema.nullable().optional(), allowedOrigins: allowedOriginsSchema.optional() })
    .strict()
    .safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const merchant = await updateMerchant(auth.merchant._id, parsed.data);
  return NextResponse.json({ merchant: serializeMerchant(merchant ?? auth.merchant) });
});
