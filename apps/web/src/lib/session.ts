import { getAuth } from "./auth";
import { isDatabaseConfigured, isMemoryTestMode } from "./db";

export type SessionUser = { id: string; email: string; name: string | null };

/** The signed-in merchant user for this request, or null. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  if (isMemoryTestMode()) return testSessionUser(headers);
  if (!isDatabaseConfigured()) return null;
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name || null };
}

/** TEST ONLY (memory test mode): the `aevify_test_user=<email>` cookie signs you in. */
function testSessionUser(headers: Headers): SessionUser | null {
  const match = /(?:^|;\s*)aevify_test_user=([^;]+)/.exec(headers.get("cookie") ?? "");
  if (!match?.[1]) return null;
  const email = decodeURIComponent(match[1]);
  return { id: `test_${email}`, email, name: null };
}
