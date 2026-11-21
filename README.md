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
| Docker and CI | `apps/web/Dockerfile`, `docker-compose.yml`, `.github/workflows` | ✅ |
| Checkout contract | `packages/contracts` | Planned |
| Gateway API and merchant dashboard | `apps/web` | Planned |
| Hosted checkout | `apps/web` | Planned |
| Chain listener and webhooks | `apps/listener` | Planned |
| `@aevify/react` and `@aevify/node` | `packages/react`, `packages/node` | Planned |
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
│   └── contracts/           Checkout contract
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Getting started

Requirements: Node.js 22+, pnpm 10 (`corepack enable`), Docker (optional).

```bash
pnpm install
cp .env.example .env        # fill in AEVUM_RPC_URL
pnpm dev                    # http://localhost:3000
```

Other commands:

```bash
pnpm typecheck
pnpm build
docker compose up --build   # web app + Postgres
```

## Aevum Testnet

| | |
|---|---|
| Chain ID | `44005` |
| Gas token | tQDAY (faucet: 5 tQDAY per address every 24 hours) |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (ERC-20, **6 decimals**) |
| Faucet | faucet.qday.info |

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
