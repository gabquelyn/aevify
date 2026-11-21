import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { keccak256, toHex } from "viem";

/**
 * LOCAL TESTING ONLY. Deploys a mock tUSD8 plus the checkout contract on a local
 * Hardhat node and registers a demo merchant, so the web app can be developed
 * without touching Aevum. Never use this module with --network aevum.
 */
export default buildModule("LocalDemoModule", (m) => {
  const deployer = m.getAccount(0);
  const merchantPayout = m.getAccount(1);

  const token = m.contract("MockUSD8");
  const checkout = m.contract("AevifyCheckout", [token, deployer, deployer, deployer, deployer, 300]);

  m.call(checkout, "registerMerchant", [keccak256(toHex("demo-store")), merchantPayout]);
  m.call(token, "mint", [deployer, 1_000_000_000n], { id: "mintDeployer" }); // 1,000 tUSD8

  return { token, checkout };
});
