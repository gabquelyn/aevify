/**
 * End-to-end check on a live network: sign a payment request the way the Aevify
 * backend will, then approve and pay it from the deployer wallet.
 *
 *   docker compose run --rm -e MERCHANT_SLUG=demo-store -e AMOUNT=0.10 \
 *     contracts npm run smoke-pay -- --network aevum
 *
 * The contract address comes from AEVIFY_CHECKOUT_ADDRESS in .env (or -e CHECKOUT_ADDRESS=0x...).
 *
 * If the contract's signer isn't the deployer, also set AEVUM_SIGNER_PRIVATE_KEY.
 */
import { network } from "hardhat";
import { paymentIdToBytes32, paymentRequestTypedData } from "@aevify/shared";
import { erc20Abi, formatUnits, getAddress, parseUnits, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkoutAddressFromEnv, merchantIdFromSlug, txLink } from "./lib.js";

const checkoutAddress = getAddress(checkoutAddressFromEnv());
const slug = process.env.MERCHANT_SLUG ?? "demo-store";
const amountText = process.env.AMOUNT ?? "0.10";

const { viem } = await network.getOrCreate();
const publicClient = await viem.getPublicClient();
const [payer] = await viem.getWalletClients();
if (!payer) throw new Error("No account configured for this network.");
const chainId = await publicClient.getChainId();

const checkout = await viem.getContractAt("AevifyCheckout", checkoutAddress);
const tokenAddress = await checkout.read.token();
const decimals = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" });
const amount = parseUnits(amountText, decimals);
const merchantId = merchantIdFromSlug(slug);

const merchant = await checkout.read.getMerchant([merchantId]);
if (merchant.payout === zeroAddress) {
  console.error(`Merchant "${slug}" isn't registered. Run scripts/register-merchant.ts first.`);
  process.exit(1);
}

const balance = await publicClient.readContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [payer.account.address],
});
if (balance < amount) {
  console.error(`Payer ${payer.account.address} has ${formatUnits(balance, decimals)}, needs ${amountText}.`);
  console.error("Claim tUSD8 at https://faucet.qday.info/en");
  process.exit(1);
}

// 1. Build and sign the payment request (this is the backend's job in production).
const block = await publicClient.getBlock();
const request = {
  paymentId: paymentIdToBytes32(`smoke_${Date.now()}`),
  merchantId,
  amount,
  expiresAt: block.timestamp + 15n * 60n,
  payer: zeroAddress,
} as const;

const onChainSigner = getAddress(await checkout.read.signer());
const signerKey = process.env.AEVUM_SIGNER_PRIVATE_KEY as Hex | undefined;
// The same helper the Aevify API uses to sign requests.
const typedData = paymentRequestTypedData({ chainId, checkoutAddress, request });

let signature: Hex;
if (onChainSigner === getAddress(payer.account.address)) {
  signature = await payer.signTypedData({ ...typedData, account: payer.account });
} else if (signerKey) {
  const signerAccount = privateKeyToAccount(signerKey);
  if (getAddress(signerAccount.address) !== onChainSigner) {
    throw new Error(`AEVUM_SIGNER_PRIVATE_KEY is for ${signerAccount.address}, contract expects ${onChainSigner}.`);
  }
  signature = await signerAccount.signTypedData(typedData);
} else {
  throw new Error(`Contract signer is ${onChainSigner}. Set AEVUM_SIGNER_PRIVATE_KEY to sign requests.`);
}

console.log(`Paying ${amountText} to "${slug}" (payout ${merchant.payout})`);

// 2. Approve, then pay.
const approveHash = await payer.writeContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: "approve",
  args: [checkoutAddress, amount],
  account: payer.account,
  chain: payer.chain,
});
await publicClient.waitForTransactionReceipt({ hash: approveHash });
console.log(`  approve: ${txLink(chainId, approveHash)}`);

const payHash = await checkout.write.pay([request, signature], { account: payer.account });
const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
console.log(`  pay:     ${txLink(chainId, payHash)} (status: ${receipt.status})`);

const payment = await checkout.read.getPayment([request.paymentId]);
console.log(`  fee: ${formatUnits(payment.fee, decimals)}, merchant received: ${formatUnits(payment.amount - payment.fee, decimals)}`);
