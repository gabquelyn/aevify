/**
 * Owner/operator actions on the checkout contract.
 *
 *   docker compose run --rm -e ACTION=status contracts npm run admin -- --network aevum
 *   docker compose run --rm -e ACTION=pause contracts npm run admin -- --network aevum
 *   docker compose run --rm -e ACTION=set-fee -e VALUE=100 contracts npm run admin -- --network aevum
 *
 * The contract address comes from AEVIFY_CHECKOUT_ADDRESS in .env (or -e CHECKOUT_ADDRESS=0x...).
 *
 * Actions:
 *   status                     Show configuration (no transaction)
 *   pause                      Stop new payments (operator or owner). Refunds keep working.
 *   unpause                    Resume payments (owner)
 *   set-fee VALUE=<bps>        Change the fee in basis points, max 500 = 5% (owner)
 *   set-signer VALUE=<addr>    Rotate the backend signing key (owner)
 *   set-operator VALUE=<addr>  Change the operator (owner)
 *   set-fee-recipient VALUE=<addr>  Change where fees go (owner)
 */
import { network } from "hardhat";
import { getAddress, type Hash } from "viem";
import { addressLink, checkoutAddressFromEnv, requireEnv, txLink } from "./lib.js";

const checkoutAddress = getAddress(checkoutAddressFromEnv());
const action = requireEnv("ACTION");

const { viem } = await network.getOrCreate();
const publicClient = await viem.getPublicClient();
const [sender] = await viem.getWalletClients();
if (!sender) throw new Error("No account configured for this network.");
const chainId = await publicClient.getChainId();
const checkout = await viem.getContractAt("AevifyCheckout", checkoutAddress);
const opts = { account: sender.account };

async function send(hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${action}: ${txLink(chainId, hash)} (status: ${receipt.status})`);
}

switch (action) {
  case "status": {
    const [owner, signer, operator, feeRecipient, feeBps, paused, token] = await Promise.all([
      checkout.read.owner(),
      checkout.read.signer(),
      checkout.read.operator(),
      checkout.read.feeRecipient(),
      checkout.read.feeBps(),
      checkout.read.paused(),
      checkout.read.token(),
    ]);
    console.log(`Contract:      ${addressLink(chainId, checkoutAddress)}`);
    console.log(`Token:         ${token}`);
    console.log(`Owner:         ${owner}`);
    console.log(`Signer:        ${signer}`);
    console.log(`Operator:      ${operator}`);
    console.log(`Fee recipient: ${feeRecipient}`);
    console.log(`Fee:           ${feeBps} bps (${feeBps / 100}%)`);
    console.log(`Paused:        ${paused}`);
    break;
  }
  case "pause":
    await send(await checkout.write.pause(opts));
    break;
  case "unpause":
    await send(await checkout.write.unpause(opts));
    break;
  case "set-fee":
    await send(await checkout.write.setFeeBps([Number(requireEnv("VALUE"))], opts));
    break;
  case "set-signer":
    await send(await checkout.write.setSigner([getAddress(requireEnv("VALUE"))], opts));
    break;
  case "set-operator":
    await send(await checkout.write.setOperator([getAddress(requireEnv("VALUE"))], opts));
    break;
  case "set-fee-recipient":
    await send(await checkout.write.setFeeRecipient([getAddress(requireEnv("VALUE"))], opts));
    break;
  default:
    console.error(`Unknown ACTION "${action}". See the top of scripts/admin.ts.`);
    process.exit(1);
}
