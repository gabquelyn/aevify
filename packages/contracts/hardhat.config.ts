import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

/**
 * Aevify contracts: Hardhat 3 + viem.
 *
 * Secrets (RPC URL, deployer key) are read with `configVariable`, so they come from
 * environment variables or the encrypted Hardhat keystore, never from this file.
 * See DEPLOY.md.
 */
/**
 * "paris" avoids newer opcodes. Aevum supports PUSH0 (Shanghai) but not MCOPY (Cancun);
 * see DEPLOY.md step 6 for how to check.
 */
function compilerProfile() {
  return {
    version: "0.8.28",
    // Optional: point at a local solc (e.g. soljson.js from the `solc` npm package)
    // when binaries.soliditylang.org is unreachable. Leave unset to download normally.
    path: process.env.SOLC_PATH || undefined,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  };
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],

  solidity: {
    // Both profiles must be listed. Deployments (`ignition deploy`) build with "production",
    // and when it isn't defined Hardhat copies only the compiler version from "default",
    // silently dropping evmVersion, which then defaults to Cancun (MCOPY), and Aevum rejects that.
    // `npm run check:evm` guards against this.
    profiles: {
      default: compilerProfile(),
      production: compilerProfile(),
    },
  },

  networks: {
    // Local chain for rehearsals. In Docker this is the `chain` service (LOCAL_RPC_URL is set
    // by docker-compose.yml); outside Docker it's `npx hardhat node` on 127.0.0.1.
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
    },
    // QDay Aevum Testnet.
    aevum: {
      type: "http",
      chainType: "l1",
      chainId: 44005,
      url: configVariable("AEVUM_RPC_URL"),
      accounts: [configVariable("AEVUM_DEPLOYER_PRIVATE_KEY")],
    },
  },

  // Tell Hardhat where Aevum's explorer lives so `hardhat verify` can use it.
  chainDescriptors: {
    44005: {
      name: "QDay Aevum Testnet",
      blockExplorers: {
        blockscout: {
          name: "Aevum Explorer",
          url: "https://explorer-test.qday.info",
          apiUrl: "https://explorer-test.qday.info/api",
        },
      },
    },
  },

  // Aevum uses Blockscout. No API key is needed for its public API.
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: false },
    sourcify: { enabled: false },
  },
});
