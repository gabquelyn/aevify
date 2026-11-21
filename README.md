# Aevify

**Stablecoin checkout for online stores and AI agents, settled in tUSD8 on QDay Aevum Testnet.**

Built for the Aevum Builder Challenge #1. Merchants sign up, get API keys and drop in a Pay button.
Customers connect a wallet and confirm, without copying addresses or typing amounts. AI agents pay the same
checkout from their own wallets, within spending limits. Payments settle on Aevum through the Aevify
checkout contract, and merchants are notified by signed webhook.

> Testnet only. tUSD8 and tQDAY are test tokens with no value.

## Status

| Part | Path | Status |
|---|---|---|
| Landing page and design system | `apps/web`, `packages/tailwind-config` | ✅ |
| Shared types and constants | `packages/shared` | ✅ |
| Docker dev environment, production image and CI | `docker/`, `docker-compose.yml`, `apps/web/Dockerfile`, `.github/workflows` | ✅ |
| Checkout contract, tests, deploy scripts | `packages/contracts`, [DEPLOY.md](./DEPLOY.md) | ✅ (deploy to Aevum pending) |
| MongoDB connection + `/api/health` | `apps/web/src/lib/db.ts` | ✅ |
| Sign-in (Google + email links via Brevo) | `apps/web/src/lib/auth.ts`, `/signin` | ✅ |
| Gateway API: payments, keys, payout wallets (reference at `/docs/api`) | `apps/web/src/app/api` | ✅ |
| Merchant dashboard: overview, payments, payment links, refunds, developers, settings | `/dashboard` | ✅ |
| Hosted checkout (one-step permit or approve + pay, mobile, embeddable) | `/pay/:id` | ✅ |
| Chain listener and signed webhooks (Railway) | `apps/listener` | ✅ |
| `@aevify/node` (server SDK) and `@aevify/react` (Pay button + modal) | `packages/node`, `packages/react` | ✅ (npm publish pending) |
| Documentation | `/docs` (`apps/web/src/app/docs`) | ✅ |
| Demo store and agent purchase | `apps/demo-store` | Planned |

## Repository layout

```
aevify/
├── apps/
│   ├── web/                 Next.js: landing, dashboard, hosted checkout, gateway API
│   ├── listener/            Worker that watches Aevum and delivers webhooks
│   └── demo-store/          Example shop using the published npm packages
├── packages/
│   ├── shared/              Types and constants (chain, tUSD8, payment states)
│   ├── tailwind-config/     Design tokens for Tailwind CSS v4
│   ├── typescript-config/   Shared tsconfig
│   ├── react/               @aevify/react (published to npm)
│   ├── node/                @aevify/node (published to npm)
│   └── contracts/           Checkout contract (Hardhat 3), tests, deploy scripts
├── docker/                  Dev image + dependency installer used by docker-compose.yml
├── DEPLOY.md                Deploy the contract (Docker) and the web app (Vercel)
├── Makefile                 Shortcuts for the Docker commands
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Getting started

Everything runs in Docker. You only need **Docker Desktop** (or Docker Engine with Compose).
Node.js on your machine is optional.

```bash
cp .env.example .env
docker compose up            # web app at http://localhost:3000
```

Set `MONGODB_URI` in `.env` to your MongoDB connection string (for example a free MongoDB
Atlas cluster), then open http://localhost:3000/api/health to check the connection.

The first run builds the dev image and installs dependencies into a Docker volume, which takes
a few minutes. Your code is mounted into the containers, so edits reload automatically.

Common commands (`make` shortcuts in brackets; run `make help` for the full list):

```bash
docker compose run --rm -w /app contracts npm test          # all tests          [make test]
make e2e                                                     # end-to-end on a local chain
docker compose run --rm -w /app contracts npm run typecheck  # typecheck all      [make typecheck]
docker compose run --rm -w /app contracts npm run build      # build all          [make build]
docker compose up -d chain                                   # local chain :8545  [make chain]
docker compose run --rm contracts bash                       # shell              [make shell]
docker compose up --build web-prod                           # production image :3001 [make prod]
```

To add a dependency, run npm inside the container, for example:

```bash
docker compose run --rm -w /app contracts npm install <package> -w @aevify/web
```

**Deploying:** the contract deploys from Docker, and the web app deploys to Vercel with
`apps/web` as the root directory. Both are covered step by step in [DEPLOY.md](./DEPLOY.md).

## Aevum Testnet

| | |
|---|---|
| Chain ID | `44005` |
| Gas token | tQDAY (faucet: 5 tQDAY per address every 24 hours) |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (ERC-20, **6 decimals**) |
| Faucet | faucet.qday.info |

## Checkout contract

`AevifyCheckout` accepts tUSD8 for payment requests signed by the Aevify backend (EIP-712),
sends 3% to the fee recipient and the rest straight to the merchant, and never holds funds.
Safety controls: tamper-proof signed amounts, single-use expiring requests, optional
payer lock for AI agents, a 5% fee ceiling enforced on-chain, 24-hour delayed payout wallet
changes that the merchant can cancel, merchant refunds, and an emergency pause.

Details: [packages/contracts/README.md](./packages/contracts/README.md) · Deployment: [DEPLOY.md](./DEPLOY.md)

## Fees

3% per payment, taken by the checkout contract at settlement. The contract enforces a hard ceiling of 5%
that cannot be raised, not even by the Aevify admin key.

## Roadmap (beyond the challenge)

- **Card payments** through processor partners, with a settlement hold to protect against chargebacks
- **Payments from other networks**, once the QDay Bridge is live
- **x402 pay-per-request** for merchant APIs consumed by AI agents
- **MCP tool** so merchants' AI assistants can create payment links and issue refunds

## License

[MIT](./LICENSE)
