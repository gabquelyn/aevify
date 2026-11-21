# Deploying Aevify

Everything here runs in **Docker**. You don't need Node.js on your machine. The one exception
is the web app on **Vercel**, which builds `apps/web` itself (section C).

- **A. Checkout contract → QDay Aevum Testnet** (Docker), then connect the API to it
- **B. Sign-in: Google and email (Brevo)**
- **C. Web app → Vercel** (`apps/web` as the root directory)

> Everything here uses test tokens only. Never reuse a wallet that holds real funds.

Each step shows the full `docker compose` command. If you have `make`, the shortcut is shown
too (`make help` lists them all).

## Before you start

1. Install Docker Desktop (or Docker Engine with the Compose plugin).
2. From the repository root, create your env file:

   ```bash
   cp .env.example .env
   ```

3. Build the dev image and install dependencies (first time only, a few minutes):

   ```bash
   docker compose build
   docker compose run --rm deps          # make install
   ```

### How the Docker setup works

| Service | What it's for |
|---|---|
| `deps` | Installs npm packages into a Docker volume. Other services run it first automatically, and it skips the install when nothing changed. |
| `web` | Next.js dev server at http://localhost:3000 (`docker compose up`). Uses the MongoDB at `MONGODB_URI` in `.env`. |
| `contracts` | Toolbox for Hardhat: compile, test, deploy, verify, scripts. Run commands with `docker compose run --rm contracts <command>`. Starts in `packages/contracts`. |
| `chain` | Local Hardhat chain at http://localhost:8545 for rehearsals |
| `web-prod` | Production build of the web app, for self-hosting (not used by Vercel) |

Your code is mounted into the containers, so edits on your machine apply immediately. Three
Docker volumes keep state between runs:

| Volume | Holds | Lost by |
|---|---|---|
| `aevify_node_modules` | npm packages | `docker compose down -v` (just reinstalls) |
| `aevify_hardhat-cache` | Downloaded Solidity compilers | `docker compose down -v` (just re-downloads) |
| `aevify_hardhat-config` | **Your Hardhat keystore (encrypted deployer key)** | `docker compose down -v`. **Don't use `-v` unless you mean it.** |

---

# A. Checkout contract → Aevum

## What gets deployed

| Contract | Deployed by | Notes |
|---|---|---|
| `AevifyCheckout` | You | The checkout contract. One deployment serves all merchants. |
| tUSD8 | Already deployed by QDay | `0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals. Don't deploy your own. |
| `MockUSD8` | Tests and the local chain only | Never deploy it to Aevum. |

## Aevum Testnet reference

| | |
|---|---|
| Chain ID | `44005` |
| RPC | `https://rpc-test.qday.info` (already in `.env.example`) |
| Explorer (Blockscout) | https://explorer-test.qday.info |
| Explorer API (for verification) | `https://explorer-test.qday.info/api` |
| Faucet | https://faucet.qday.info/en (5 tQDAY per address every 24 hours) |

## 1. Prepare wallets

The contract has four roles. For a quick first deploy they can all be the deployer wallet,
but for the version you submit, use separate wallets so the safety story holds up:

| Role | What it does | Recommendation |
|---|---|---|
| **Owner** | Changes the fee (never above 5%), rotates keys, unpauses | A wallet you keep offline as much as possible |
| **Signer** | Signs payment requests in the backend (EIP-712). Never sends transactions, so it needs no gas. | A fresh key used only by the Aevify API |
| **Operator** | Registers merchants, can pause in an emergency | A fresh key used by the Aevify backend; needs a little tQDAY |
| **Fee recipient** | Receives the 3% fee | Any address you control |

The **deployer** is whichever key sends the deploy transaction. It can be the owner.

Create new wallets in MetaMask and write down each address.

## 2. Fund the deployer

1. Add Aevum to MetaMask: https://wiki.qday.info/guide/start/add-network
2. Claim **tQDAY** (gas) for the deployer at https://faucet.qday.info/en. Also fund the
   operator if it's a different wallet.
3. Claim some **tUSD8** for the deployer too, for the test payment in step 9.

## 3. Run the tests

```bash
docker compose run --rm contracts npm test        # make test
```

All tests should pass. The first run downloads the Solidity compiler (0.8.28) into the cache
volume.

## 4. Store your deployer key

The RPC URL is already in `.env`. The deployer's private key goes in **Hardhat's encrypted
keystore**, which lives in the `hardhat-config` Docker volume:

```bash
docker compose run --rm contracts npx hardhat keystore set AEVUM_DEPLOYER_PRIVATE_KEY
# make keystore KEY=AEVUM_DEPLOYER_PRIVATE_KEY
```

The first time, Hardhat asks you to create a keystore password, then for the key (`0x...`).
Commands that need the key will ask for the password.

**Alternative:** put `AEVUM_DEPLOYER_PRIVATE_KEY=0x...` in `.env` (uncomment the line). It's
simpler but stores the key unencrypted on disk. Never commit `.env`.

## 5. Rehearse on the local chain (optional, 2 minutes)

This runs the whole flow with a mock tUSD8, so your first Aevum deploy isn't your first deploy.

```bash
docker compose up -d chain                              # make chain
docker compose run --rm contracts npm run deploy:local  # make deploy-local
```

Copy the `LocalDemoModule#AevifyCheckout` address from the output, then:

```bash
docker compose run --rm -e CHECKOUT_ADDRESS=0x... contracts npm run smoke-pay -- --network localhost
# make smoke-local CHECKOUT=0x...
```

You should see `status: success`, a fee of 0.003 and 0.097 to the merchant. Stop the chain
with `docker compose stop chain` (`make chain-stop`). Each `deploy:local` starts fresh.

## 6. Check Aevum's EVM version (optional)

The contracts compile for the `paris` EVM version, which avoids newer opcodes in case Aevum
doesn't support them. To check (the dev image includes `curl`):

```bash
# PUSH0 (Shanghai): "result":"0x" means supported
docker compose run --rm contracts curl -s -X POST https://rpc-test.qday.info \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"data":"0x5f5ff3"},"latest"]}'

# MCOPY (Cancun): "result":"0x" means supported
docker compose run --rm contracts curl -s -X POST https://rpc-test.qday.info \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"data":"0x6000600060005e00"},"latest"]}'
```

An error mentioning an invalid opcode means it isn't supported. **You don't need to change
anything either way.** `paris` works on both. If both succeed and you want the latest
OpenZeppelin release, raise `evmVersion` to `"cancun"` in `packages/contracts/hardhat.config.ts`
and upgrade `@openzeppelin/contracts` (pinned to 5.0.2 because later versions need Cancun).

## 7. Write the deployment parameters

On your machine:

```bash
mkdir -p packages/contracts/ignition/parameters
cp packages/contracts/ignition/parameters.example.json packages/contracts/ignition/parameters/aevum.json
```

Edit `packages/contracts/ignition/parameters/aevum.json` and fill in the addresses from step 1.
Leave `token` as tUSD8 and `feeBps` as `300` (3%). Any field you delete defaults to the deployer.

These are public addresses, not secrets, so the file is safe to commit.

## 8. Deploy and verify

```bash
docker compose run --rm contracts npm run deploy:aevum -- --parameters ignition/parameters/aevum.json
# make deploy
```

Hardhat shows a summary and asks you to confirm. Check that it says **chain ID 44005**, then
confirm. It will:

1. Compile and deploy `AevifyCheckout`
2. Wait for confirmation
3. Verify the source code on the Aevum explorer (Blockscout)

At the end you'll see:

```
AevifyCheckoutModule#AevifyCheckout - 0x...
```

Put that address in `.env`:

```bash
AEVIFY_CHECKOUT_ADDRESS=0x...
```

The scripts in steps 9–10 and the app read it from there.

Ignition also records the deployment in
`packages/contracts/ignition/deployments/chain-44005/`. **Commit that folder**: it's your proof
of deployment for the judges and lets Ignition resume or verify later.

Open `https://explorer-test.qday.info/address/<address>`. You should see a "verified" mark
and a **Contract** tab with the source.

### If verification failed or was skipped

Explorers sometimes need a minute to index a new contract. Retry with:

```bash
docker compose run --rm contracts npm run verify:aevum     # make verify
```

Or verify the contract directly (constructor arguments in this order: token, owner, signer,
operator, feeRecipient, feeBps):

```bash
docker compose run --rm contracts npx hardhat verify --network aevum <CHECKOUT_ADDRESS> \
  0x456569838f1d43009A91ebA4263147Afd7233483 <OWNER> <SIGNER> <OPERATOR> <FEE_RECIPIENT> 300
```

## 9. Register a merchant and make a test payment

Merchants are identified on-chain by `keccak256` of their slug (for example `demo-store`).
The backend uses the same rule.

**Register** (must be sent by the operator or owner):

```bash
docker compose run --rm -e MERCHANT_SLUG=demo-store -e MERCHANT_PAYOUT=0x<merchant wallet> \
  contracts npm run register-merchant -- --network aevum
# make register SLUG=demo-store PAYOUT=0x...
```

If your deployer isn't the operator or owner, store the operator's key as
`AEVUM_DEPLOYER_PRIVATE_KEY` for this step, or register from the owner wallet.

**Test payment.** This signs a request like the backend will, then approves and pays
0.10 tUSD8 from the deployer:

```bash
docker compose run --rm -e MERCHANT_SLUG=demo-store -e AMOUNT=0.10 \
  contracts npm run smoke-pay -- --network aevum
# make smoke
```

If the signer isn't the deployer, add `-e AEVUM_SIGNER_PRIVATE_KEY=0x...` for this one command.

Expected output:

```
Paying 0.10 to "demo-store" (payout 0x...)
  approve: https://explorer-test.qday.info/tx/0x...
  pay:     https://explorer-test.qday.info/tx/0x... (status: success)
  fee: 0.003, merchant received: 0.097
```

Open the `pay` link. On the transaction page you should see two tUSD8 transfers (0.097 to the
merchant and 0.003 to the fee recipient) and a `PaymentPaid` event. That's the full on-chain
flow, live on Aevum.

## 10. Admin quick reference

Uses the owner key (or the operator key for `pause`):

```bash
docker compose run --rm -e ACTION=status contracts npm run admin -- --network aevum            # make status
docker compose run --rm -e ACTION=pause contracts npm run admin -- --network aevum             # operator or owner; refunds still work
docker compose run --rm -e ACTION=unpause contracts npm run admin -- --network aevum           # owner only
docker compose run --rm -e ACTION=set-fee -e VALUE=100 contracts npm run admin -- --network aevum       # owner: 1%; above 500 (5%) reverts
docker compose run --rm -e ACTION=set-signer -e VALUE=0x... contracts npm run admin -- --network aevum  # owner: rotate the signing key
```

`set-operator` and `set-fee-recipient` work the same way. Ownership moves in two steps
(`transferOwnership`, then `acceptOwnership` from the new owner) and can't be renounced.

## 11. Connect the API to the contract

The API signs payment requests with the **signer** key and registers merchants with the
**operator** key, so it needs the private keys of the signer and operator addresses you
deployed with (step 1). In `.env`:

```bash
AEVIFY_CHECKOUT_ADDRESS=0x...        # from step 8
AEVIFY_SIGNER_PRIVATE_KEY=0x...      # the signer wallet's key (needs no gas)
AEVIFY_OPERATOR_PRIVATE_KEY=0x...    # the operator wallet's key (needs a little tQDAY)
```

Restart the app (`docker compose restart web`) and open http://localhost:3000/api/health.
You want:

```json
{ "status": "ok", "database": "connected", "chain": { "signer": "ok", "operator": "ok" } }
```

`"mismatch"` means the key isn't the one the contract expects. Use the right key, or point
the contract at the key's address with `ACTION=set-signer` / `ACTION=set-operator` (step 10).

Then try the full flow:

1. Sign in at http://localhost:3000/signin and create your business.
2. **Connect wallet** (MetaMask on Aevum). The operator registers it on-chain; the
   dashboard shows "Verified on Aevum".
3. **Create secret key** and copy it.
4. Create a payment:

   ```bash
   curl -X POST http://localhost:3000/api/v1/payments \
     -H "Authorization: Bearer sk_test_..." -H "Content-Type: application/json" \
     -d '{ "amount": "0.10", "orderId": "test-1" }'
   ```

The hosted checkout page (`checkoutUrl`) comes next. Until then, the response and
`GET /api/v1/checkout/<id>` show exactly what to sign and send (see `docs/API.md`).

## Changing the contract later

1. Edit `packages/contracts/contracts/AevifyCheckout.sol` and update the tests.
2. `docker compose run --rm contracts npm test`
3. `docker compose run --rm contracts npm run export-abi` to refresh the ABI in `@aevify/shared`.
4. Deploy a new version under a new deployment ID:

   ```bash
   docker compose run --rm contracts npm run deploy:aevum -- \
     --parameters ignition/parameters/aevum.json --deployment-id aevum-v2
   # make deploy ARGS="--deployment-id aevum-v2"
   ```

5. Update `AEVIFY_CHECKOUT_ADDRESS` and register merchants again on the new contract.

---

# B. Sign-in: Google and email (Brevo)

Merchants sign in with Google or with an emailed link. Both are optional in development:
without them, the email link is printed in the web logs (`docker compose logs web`).

## Google

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins:** `http://localhost:3000` (and your Vercel URL later).
4. **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google`
   (and `https://<your-vercel-domain>/api/auth/callback/google` later).
5. Copy both the **Client ID and the Client Secret** into `.env`:

   ```bash
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

The "Continue with Google" button appears once both are set.

## Email links via Brevo

1. Brevo → **Settings → SMTP & API → SMTP** tab. Copy the **SMTP login** and generate an
   **SMTP key**. Brevo's SMTP relay needs an SMTP key; a Brevo API key won't work.
2. Brevo → **Senders**: add and verify the address you'll send from.
3. In `.env`:

   ```bash
   BREVO_SMTP_LOGIN=...           # e.g. 123abc@smtp-brevo.com or your login email
   BREVO_SMTP_KEY=...
   EMAIL_FROM=Aevify <no-reply@yourdomain.com>   # must be a verified Brevo sender
   ```

## Session secret

Required in production (any long random string):

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```

---

# C. Web app → Vercel

Vercel builds the web app from source, so Docker isn't involved here. The repository is an npm
workspace, and `apps/web` uses the shared packages in `packages/`, so Vercel needs the whole
repository with `apps/web` as the **Root Directory**.

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project**, then import the repository.
3. Configure:

   | Setting | Value |
   |---|---|
   | Framework Preset | Next.js (auto-detected) |
   | Root Directory | `apps/web` |
   | Build / Install / Output | Leave the defaults |

4. Add environment variables (Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` |
   | `BETTER_AUTH_SECRET` | A new long random string (not your local one) |
   | `MONGODB_URI`, `MONGODB_DB` | Your Atlas connection (allow `0.0.0.0/0` in Atlas Network Access) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Add the Vercel redirect URI in Google Cloud first (section B) |
   | `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`, `EMAIL_FROM` | From section B |
   | `AEVUM_RPC_URL`, `AEVUM_CHAIN_ID` | `https://rpc-test.qday.info`, `44005` |
   | `AEVIFY_CHECKOUT_ADDRESS` | From step 8 |
   | `AEVIFY_SIGNER_PRIVATE_KEY`, `AEVIFY_OPERATOR_PRIVATE_KEY` | From step 11. Mark them **Sensitive**. |

   **Never add the deployer or owner keys to Vercel.** The signer and operator keys can only
   sign payment requests and register merchants; they can't move funds or change fees.
5. Deploy, then open `https://<your-vercel-domain>/api/health`.

If the build can't find `@aevify/shared` or `@aevify/tailwind-config`, set the Build Command
to `cd ../.. && npx turbo run build --filter=@aevify/web` so the build runs from the
repository root.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Configuration Variable "AEVUM_DEPLOYER_PRIVATE_KEY" not found` | Store it in the keystore (step 4). If you ran `docker compose down -v`, the keystore volume was deleted, so store it again. |
| `Invalid URL value for the configuration variable "AEVUM_RPC_URL"` | `.env` has `AEVUM_RPC_URL=` with no value. Set it or comment it out; an empty value overrides the keystore. |
| `insufficient funds for gas` | Claim tQDAY for that wallet at the faucet. Gas comes from the wallet sending the transaction. |
| Deploy shows the wrong chain ID | Check `AEVUM_RPC_URL` in `.env` is `https://rpc-test.qday.info`. |
| `EACCES: permission denied` writing files (Linux) | The containers run as user ID 1000. Run `sudo chown -R 1000:1000 .` in the repository, or make sure your user ID is 1000 (`id -u`). |
| `ECONNREFUSED` with `--network localhost` | Start the chain first: `docker compose up -d chain`. |
| Port 3000 or 8545 already in use | Stop whatever uses it on your machine, or change the left-hand port in `docker-compose.yml`. |
| Dependencies seem stale or broken | `docker compose run --rm deps`. To reinstall from scratch: `docker volume rm aevify_node_modules`, then run `deps` again. |
| `/api/health` shows `"database": "not_configured"` | Set `MONGODB_URI` in `.env` (uncomment the line), then `docker compose restart web`. |
| `/api/health` shows `"database": "error"` | Check the URI's user and password. In MongoDB Atlas, also allow your IP (Network Access); for Vercel and Railway, allow `0.0.0.0/0`. |
| Sign-in email never arrives | Check `docker compose logs web` for SMTP errors. Use an SMTP key (not an API key), and make `EMAIL_FROM` a verified Brevo sender. Without SMTP settings, the link is printed in those logs instead. |
| Google: `redirect_uri_mismatch` | Add `<NEXT_PUBLIC_APP_URL>/api/auth/callback/google` exactly to the OAuth client's redirect URIs. |
| `/api/health` shows `"signer": "mismatch"` | `AEVIFY_SIGNER_PRIVATE_KEY` isn't the contract's signer (step 11). |
| Payments: `merchant_not_ready` | Connect a payout wallet in the dashboard first. |
| Web app doesn't reload on file changes | Restart it with `docker compose restart web`. |
| `Merchant ... isn't registered` | Run step 9's register command first, with the same `MERCHANT_SLUG`. |
| `Set AEVIFY_CHECKOUT_ADDRESS in .env` | Add the deployed address to `.env` (step 8), or pass `-e CHECKOUT_ADDRESS=0x...`. |
| `InvalidSignature` | The request was signed by a key that isn't the contract's `signer`, or for a different contract or chain. |
| `ERC20InsufficientAllowance` | The payer didn't approve enough tUSD8. Remember tUSD8 has **6** decimals: 1 tUSD8 = `1000000`. |
| `RequestExpired` | Test payment requests expire after 15 minutes. Run it again. |
| `Unauthorized` on register | The sending key isn't the operator or owner. |
