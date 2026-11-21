/**
 * Server-side configuration, read lazily so `next build` works without secrets.
 * Every value comes from .env (Docker) or the Vercel project settings.
 */

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  /** Public base URL of this app, used in magic links, OAuth callbacks and checkout URLs. */
  appUrl: () => (optional("BETTER_AUTH_URL") ?? optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000").replace(/\/$/, ""),

  isProduction: () => process.env.NODE_ENV === "production",

  // --- Auth -------------------------------------------------------------
  authSecret: () => optional("BETTER_AUTH_SECRET"),
  google: () => {
    const clientId = optional("GOOGLE_CLIENT_ID");
    const clientSecret = optional("GOOGLE_CLIENT_SECRET");
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  },

  // --- Email (Brevo SMTP relay) -------------------------------------------
  smtp: () => {
    const user = optional("BREVO_SMTP_LOGIN");
    const pass = optional("BREVO_SMTP_KEY");
    if (!user || !pass) return undefined;
    return {
      host: optional("BREVO_SMTP_HOST") ?? "smtp-relay.brevo.com",
      port: Number(optional("BREVO_SMTP_PORT") ?? 587),
      user,
      pass,
    };
  },
  emailFrom: () => optional("EMAIL_FROM") ?? "Aevify <no-reply@aevify.local>",

  // --- Chain ------------------------------------------------------------
  rpcUrl: () => optional("AEVUM_RPC_URL"),
  /** RPC URL given to browsers (wallets). Defaults to AEVUM_RPC_URL; set it separately if that one contains an API key. */
  publicRpcUrl: () => optional("AEVUM_PUBLIC_RPC_URL") ?? optional("AEVUM_RPC_URL"),
  chainId: () => Number(optional("AEVUM_CHAIN_ID") ?? 44005),
  checkoutAddress: () => optional("AEVIFY_CHECKOUT_ADDRESS"),
  signerPrivateKey: () => optional("AEVIFY_SIGNER_PRIVATE_KEY"),
  operatorPrivateKey: () => optional("AEVIFY_OPERATOR_PRIVATE_KEY"),
};
