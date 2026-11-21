import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { apiError } from "@/lib/http";

// Better Auth endpoints: magic link, Google OAuth callback, session, sign-out.
export const dynamic = "force-dynamic";

function handlers() {
  return toNextJsHandler(getAuth());
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return apiError(503, "service_unavailable", "Database isn't configured (MONGODB_URI).");
  return handlers().GET(request);
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return apiError(503, "service_unavailable", "Database isn't configured (MONGODB_URI).");
  return handlers().POST(request);
}
