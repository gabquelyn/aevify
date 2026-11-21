# Browser end-to-end test (dashboard + hosted checkout)

Drives the real app in Chromium against a local Hardhat chain, with a scripted wallet injected
into the page (it forwards wallet requests to the Hardhat node, whose dev accounts are unlocked).
It covers: onboarding, connecting a payout wallet (on-chain), creating a secret key and a payment
link, paying it with a one-step permit, paying another with approve-then-pay plus the successUrl
redirect, a payer-locked payment opened by the wrong wallet, a wallet with no tUSD8 (mobile),
refunding from the payout wallet, and the overview stats. Screenshots go to `screenshots/`.

The app runs in **memory test mode** (`AEVIFY_TEST_MODE=memory`): an in-memory database and a
test sign-in cookie instead of MongoDB and real sign-in. It only works with `next dev`; it can
never turn on in a production build.

Requirements: Python 3 with `pip install playwright && playwright install chromium`.

```bash
# 1. Local chain + contracts
docker compose up -d chain
docker compose run --rm contracts npm run deploy:local

# 2. Fund the test wallets (Hardhat accounts #1, #4, #5) with mock tUSD8
docker compose run --rm contracts npx hardhat run scripts/fund-test-wallets.ts --network localhost

# 3. The app in memory test mode, against the local chain
docker compose run --rm --service-ports -w /app/apps/web \
  -e AEVIFY_TEST_MODE=memory -e AEVUM_RPC_URL=http://chain:8545 -e AEVUM_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
  -e AEVUM_CHAIN_ID=31337 -e AEVIFY_CHECKOUT_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 \
  -e AEVIFY_SIGNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  -e AEVIFY_OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  -e NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  web npx next dev --hostname 0.0.0.0 --port 3000

# 4. In another terminal, on your machine
APP_URL=http://localhost:3000 RPC_URL=http://127.0.0.1:8545 python3 apps/web/test-browser/ui_e2e.py
```

The keys above are Hardhat's public development keys. Never use them anywhere real.
