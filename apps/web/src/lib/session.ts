import { getAuth } from "./auth";
import { isDatabaseConfigured } from "./db";

export type SessionUser = { id: string; email: string; name: string | null };

/** The signed-in merchant user for this request, or null. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name || null };
}
