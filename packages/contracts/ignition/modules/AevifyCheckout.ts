import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/** tUSD8 on QDay Aevum Testnet (already deployed by QDay; 6 decimals). */
const TUSD8_AEVUM = "0x456569838f1d43009A91ebA4263147Afd7233483";

/**
 * Deploys the Aevify checkout contract.
 *
 * Every role defaults to the deployer so a first deploy "just works", but for anything
 * beyond a quick test you should pass separate addresses in a parameters file
 * (see ignition/parameters.example.json and DEPLOY.md).
 */
export default buildModule("AevifyCheckoutModule", (m) => {
  const deployer = m.getAccount(0);

  const token = m.getParameter("token", TUSD8_AEVUM);
  const owner = m.getParameter("owner", deployer);
  const signer = m.getParameter("signer", deployer);
  const operator = m.getParameter("operator", deployer);
  const feeRecipient = m.getParameter("feeRecipient", deployer);
  const feeBps = m.getParameter("feeBps", 300);

  const checkout = m.contract("AevifyCheckout", [token, owner, signer, operator, feeRecipient, feeBps]);

  return { checkout };
});
