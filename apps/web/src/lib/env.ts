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
  signerPrivateKey: () => privateKey("AEVIFY_SIGNER_PRIVATE_KEY"),
  operatorPrivateKey: () => privateKey("AEVIFY_OPERATOR_PRIVATE_KEY"),
};

/**
 * A private key from the environment, with or without the 0x prefix (MetaMask exports keys
 * without it; viem needs it). Anything that isn't 32 bytes of hex is a configuration error.
 */
function privateKey(name: string): `0x${string}` | undefined {
  const raw = optional(name)?.trim().replace(/^["']|["']$/g, "");
  if (!raw) return undefined;
  const key = raw.startsWith("0x") || raw.startsWith("0X") ? `0x${raw.slice(2)}` : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${name} must be a private key: 64 hex characters, with or without 0x.`);
  }
  return key as `0x${string}`;
}

