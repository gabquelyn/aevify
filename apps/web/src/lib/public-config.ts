import { AEVUM_EXPLORER_URL, AEVUM_TESTNET } from "@aevify/shared";
import { getChainContext, getCheckoutToken } from "./chain";
import { env } from "./env";

/** Chain details a browser wallet needs (to switch to, or add, the network). */
export function publicChainConfig() {
  const id = env.chainId();
  const isAevum = id === AEVUM_TESTNET.id;
  return {
    id,
    name: isAevum ? AEVUM_TESTNET.name : `Local chain ${id}`,
    rpcUrl: env.publicRpcUrl() ?? null,
    explorerUrl: isAevum ? AEVUM_EXPLORER_URL : null,
    nativeCurrency: AEVUM_TESTNET.nativeCurrency,
    faucetUrl: isAevum ? "https://faucet.qday.info/en" : null,
  };
}

export type PublicChainConfig = ReturnType<typeof publicChainConfig>;

/** Everything the dashboard's wallet actions need (refunds, cancelling payout changes). */
export async function publicCheckoutConfig() {
  const { checkoutAddress } = getChainContext();
  return { chain: publicChainConfig(), checkoutAddress, token: await getCheckoutToken() };
}
