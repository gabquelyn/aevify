/**
 * Fail if any deployable contract uses opcodes Aevum doesn't support.
 * Aevum (checked in DEPLOY.md step 6) supports Shanghai (PUSH0) but not Cancun (MCOPY,
 * TLOAD/TSTORE, BLOBHASH, BLOBBASEFEE).
 *
 *   npm run check:evm     (builds with the production profile, which deployments use)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = { 0x5e: "MCOPY", 0x5c: "TLOAD", 0x5d: "TSTORE", 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE" };

function* artifacts(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* artifacts(path);
    else if (name.endsWith(".json") && !name.endsWith(".dbg.json") && !path.includes("build-info")) yield path;
  }
}

/** Walk the bytecode as instructions (skipping PUSH data), stopping at the metadata. */
function forbiddenOpcodes(hex) {
  const code = Buffer.from(hex.replace(/^0x/, ""), "hex");
  const found = new Set();
  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    if (op === 0xfe && i > code.length - 60) break; // INVALID before CBOR metadata
    if (FORBIDDEN[op]) found.add(FORBIDDEN[op]);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // PUSH1..PUSH32 data
  }
  return [...found];
}

let failed = false;
let checked = 0;
for (const file of artifacts("artifacts/contracts")) {
  const { contractName, deployedBytecode, sourceName } = JSON.parse(readFileSync(file, "utf8"));
  if (!deployedBytecode || deployedBytecode === "0x" || sourceName?.includes("/test/") || sourceName?.includes("mocks/")) continue;
  checked++;
  const bad = forbiddenOpcodes(deployedBytecode);
  if (bad.length) {
    failed = true;
    console.error(`✗ ${contractName}: uses ${bad.join(", ")}, which Aevum rejects`);
  } else {
    console.log(`✓ ${contractName}: no Cancun opcodes`);
  }
}
if (checked === 0) {
  console.error("No artifacts found. Build first.");
  process.exit(1);
}
process.exit(failed ? 1 : 0);
