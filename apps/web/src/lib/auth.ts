import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getDb } from "./db";
import { magicLinkEmail, sendEmail } from "./email";
import { env } from "./env";

/**
 * Merchant sign-in: email magic links (sent through Brevo) and Google.
 * Better Auth stores users and sessions in MongoDB (collections: user, session, account, verification).
 *
 * Built on first use, so `next build` doesn't need MONGODB_URI or secrets.
 */
function createAuth() {
  const google = env.google();
  const secret = env.authSecret();
  if (!secret && env.isProduction()) {
    throw new Error("BETTER_AUTH_SECRET is required in production. Generate one with: openssl rand -base64 32");
  }

  return betterAuth({
    appName: "Aevify",
    baseURL: env.appUrl(),
    trustedOrigins: env.trustedOrigins(),
    // Dev-only fallback so `docker compose up` works before you've set a secret.
    secret: secret ?? "aevify-dev-only-secret-change-me-0000000000",
    database: mongodbAdapter(getDb()),
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily while in use
    },
    socialProviders: google
      ? { google: { clientId: google.clientId, clientSecret: google.clientSecret, prompt: "select_account" } }
      : {},
    plugins: [
      magicLink({
        expiresIn: 60 * 10, // 10 minutes
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(magicLinkEmail(email, url));
        },
      }),
      nextCookies(), // must be last
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

declare global {
  var _aevifyAuth: Auth | undefined;
}

export function getAuth(): Auth {
  globalThis._aevifyAuth ??= createAuth();
  return globalThis._aevifyAuth;
}

export function isGoogleSignInEnabled(): boolean {
  return Boolean(env.google());
}
