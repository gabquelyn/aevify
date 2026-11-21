/**
 * Register a merchant and its payout wallet on the checkout contract.
 * Must be sent by the contract's operator or owner.
 *
 *   docker compose run --rm -e MERCHANT_SLUG=demo-store -e MERCHANT_PAYOUT=0x... \
 *     contracts npm run register-merchant -- --network aevum
 *
 * The contract address comes from AEVIFY_CHECKOUT_ADDRESS in .env (or -e CHECKOUT_ADDRESS=0x...).
 */
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";
import { addressLink, checkoutAddressFromEnv, merchantIdFromSlug, requireEnv, txLink } from "./lib.js";

const checkoutAddress = getAddress(checkoutAddressFromEnv());
const slug = requireEnv("MERCHANT_SLUG");
const payout = getAddress(requireEnv("MERCHANT_PAYOUT"));

const { viem } = await network.getOrCreate();
const publicClient = await viem.getPublicClient();
const [sender] = await viem.getWalletClients();
if (!sender) throw new Error("No account configured for this network.");
const chainId = await publicClient.getChainId();

const checkout = await viem.getContractAt("AevifyCheckout", checkoutAddress);
const merchantId = merchantIdFromSlug(slug);

const existing = await checkout.read.getMerchant([merchantId]);
if (existing.payout !== zeroAddress) {
  console.log(`Merchant "${slug}" is already registered with payout ${existing.payout}.`);
  process.exit(0);
}

console.log(`Registering "${slug}"`);
console.log(`  merchantId: ${merchantId}`);
console.log(`  payout:     ${payout}`);

const hash = await checkout.write.registerMerchant([merchantId, payout], { account: sender.account });
await publicClient.waitForTransactionReceipt({ hash });

console.log(`Done: ${txLink(chainId, hash)}`);
console.log(`Contract: ${addressLink(chainId, checkoutAddress)}`);
