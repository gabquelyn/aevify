/**
 * LOCAL CHAIN ONLY: mint mock tUSD8 to the Hardhat dev accounts used by the browser test
 * (apps/web/test-browser). Run after `npm run deploy:local`:
 *
 *   docker compose run --rm contracts npx hardhat run scripts/fund-test-wallets.ts --network localhost
 */
import { network } from "hardhat";
import { getAddress, parseUnits } from "viem";

const CHECKOUT = getAddress(process.env.CHECKOUT_ADDRESS ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
const WALLETS: Array<[string, string]> = [
  ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "50"], // #1 merchant payout wallet (needs tokens to refund)
  ["0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", "100"], // #4 customer
  ["0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", "100"], // #5 customer
];

const { viem } = await network.getOrCreate();
const publicClient = await viem.getPublicClient();
if ((await publicClient.getChainId()) !== 31337) throw new Error("Refusing to run: this script is for the local chain only.");

const checkout = await viem.getContractAt("AevifyCheckout", CHECKOUT);
const token = await viem.getContractAt("MockUSD8", await checkout.read.token());
for (const [to, amount] of WALLETS) {
  await publicClient.waitForTransactionReceipt({ hash: await token.write.mint([getAddress(to), parseUnits(amount, 6)]) });
  console.log(`Minted ${amount} mock tUSD8 to ${to}`);
}
