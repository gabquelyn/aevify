# @aevify/contracts

The Aevify checkout contract for QDay Aevum Testnet. Built with Hardhat 3, viem and
OpenZeppelin Contracts 5.0.2.

**Deploying? See [DEPLOY.md](../../DEPLOY.md).**

## AevifyCheckout

Customers and AI agents pay merchants in tUSD8 through signed payment requests.

1. The Aevify backend signs a payment request (EIP-712): payment ID, merchant ID, amount,
   expiry, and optionally the only address allowed to pay.
2. The payer calls `pay(request, signature)` (or `payWithPermit` for one-step approval if the
   token supports EIP-2612).
3. The contract moves tUSD8 straight from the payer: 3% to the fee recipient, the rest to the
   merchant's payout wallet. It never holds funds.

| Safety control | How |
|---|---|
| Amounts can't be tampered with | Requests are signed by the backend `signer`; any change breaks the signature |
| No double payments | Each payment ID can be paid once |
| No stale payments | Requests expire |
| Agent payments can be locked to the agent's wallet | `payer` field in the request |
| Fee can't be raised past 5% | `MAX_FEE_BPS` constant, checked on every change |
| Hijacked accounts can't redirect payouts instantly | Payout wallet changes wait 24 hours; the current payout wallet can cancel |
| Refunds | Merchant's payout wallet refunds the original payer, up to the amount paid |
| Emergency stop | Operator or owner can pause new payments; refunds keep working; only the owner unpauses |
| Admin keys stay recoverable | Two-step ownership transfer; renouncing is disabled |

## Commands

Run from this folder:

| Command | What it does |
|---|---|
| `npm test` | Run the contract tests |
| `npm run build` | Compile |
| `npm run node` | Start a local Hardhat node |
| `npm run deploy:local` | Deploy mock tUSD8 + checkout + a demo merchant to the local node |
| `npm run deploy:aevum -- --parameters ignition/parameters/aevum.json` | Deploy and verify on Aevum |
| `npm run verify:aevum` | Retry verification of the Aevum deployment |
| `npm run register-merchant -- --network <net>` | Register a merchant (see DEPLOY.md for env vars) |
| `npm run smoke-pay -- --network <net>` | Sign and pay a small test payment end to end |
| `npm run admin -- --network <net>` | Status, pause/unpause, fee and key changes (see DEPLOY.md) |
| `npm run export-abi` | Copy the ABI into `@aevify/shared` |

## Layout

```
contracts/
  AevifyCheckout.sol        The checkout contract
  test/MockUSD8.sol         Test-only stand-in for tUSD8 (6 decimals, permit)
test/AevifyCheckout.ts      Tests (node:test + viem)
ignition/modules/           Deployment modules (Aevum and local demo)
ignition/parameters.example.json
scripts/                    Register merchant, smoke payment, ABI export
```
