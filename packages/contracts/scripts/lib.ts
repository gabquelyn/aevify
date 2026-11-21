export { merchantIdFromSlug } from "@aevify/shared";

export const EXPLORER_URL = "https://explorer-test.qday.info";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}. See DEPLOY.md.`);
    process.exit(1);
  }
  return value;
}

/**
 * The checkout contract address: CHECKOUT_ADDRESS if given on the command line,
 * otherwise AEVIFY_CHECKOUT_ADDRESS from .env.
 */
export function checkoutAddressFromEnv(): string {
  const value = process.env.CHECKOUT_ADDRESS || process.env.AEVIFY_CHECKOUT_ADDRESS;
  if (!value) {
    console.error("Set AEVIFY_CHECKOUT_ADDRESS in .env, or pass CHECKOUT_ADDRESS. See DEPLOY.md.");
    process.exit(1);
  }
  return value;
}

export function txLink(chainId: number, hash: string): string {
  return chainId === 44005 ? `${EXPLORER_URL}/tx/${hash}` : hash;
}

export function addressLink(chainId: number, address: string): string {
  return chainId === 44005 ? `${EXPLORER_URL}/address/${address}` : address;
}
