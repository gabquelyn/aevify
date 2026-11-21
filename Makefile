# Shortcuts for the Docker commands in README.md and DEPLOY.md.
# No make (e.g. Windows)? Copy the command after each target instead.
#
# Pass extra arguments with ARGS, e.g.  make deploy ARGS="--deployment-id aevum-v2"

COMPOSE   := docker compose
CONTRACTS := $(COMPOSE) run --rm contracts
PARAMS    ?= ignition/parameters/aevum.json

.PHONY: help up down logs shell install test test-web e2e typecheck build \
        chain chain-stop deploy-local smoke-local \
        keystore deploy verify register smoke status prod

help: ## List the shortcuts
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-14s %s\n", $$1, $$2}'

# --- App -----------------------------------------------------------------

up: ## Start the web app (localhost:3000)
	$(COMPOSE) up

down: ## Stop everything (keeps volumes: node_modules, Hardhat keystore)
	$(COMPOSE) --profile local --profile prod down

logs: ## Follow logs of running services
	$(COMPOSE) logs -f

shell: ## Open a shell in the contracts container
	$(CONTRACTS) bash

install: ## Install/refresh npm dependencies in the node_modules volume
	$(COMPOSE) run --rm deps

prod: ## Build and run the production web image (localhost:3001)
	$(COMPOSE) up --build web-prod

# --- Contracts -----------------------------------------------------------

test: ## Run all tests (contracts + web API)
	$(COMPOSE) run --rm -w /app contracts npm test

test-web: ## Run the web API tests
	$(COMPOSE) run --rm -w /app/apps/web contracts npm test

e2e: ## End-to-end: real contract on a fresh local chain + the API
	$(COMPOSE) up -d --force-recreate chain
	$(CONTRACTS) npm run deploy:local
	$(COMPOSE) run --rm -w /app/apps/web -e E2E_RPC_URL=http://chain:8545 contracts npm run test:e2e

typecheck: ## Typecheck every workspace
	$(COMPOSE) run --rm -w /app contracts npm run typecheck

build: ## Build every workspace
	$(COMPOSE) run --rm -w /app contracts npm run build

chain: ## Start a local Hardhat chain in the background (localhost:8545)
	$(COMPOSE) up -d chain

chain-stop: ## Stop the local chain
	$(COMPOSE) stop chain

deploy-local: ## Deploy mock tUSD8 + checkout + demo merchant to the local chain
	$(CONTRACTS) npm run deploy:local

smoke-local: ## Test payment on the local chain (CHECKOUT=<address from deploy-local>)
	$(COMPOSE) run --rm -e CHECKOUT_ADDRESS=$(CHECKOUT) contracts npm run smoke-pay -- --network localhost

keystore: ## Store a secret in the Hardhat keystore (KEY=AEVUM_DEPLOYER_PRIVATE_KEY)
	$(CONTRACTS) npx hardhat keystore set $(KEY)

deploy: ## Deploy + verify on Aevum (PARAMS=ignition/parameters/aevum.json)
	$(CONTRACTS) npm run deploy:aevum -- --parameters $(PARAMS) $(ARGS)

verify: ## Retry explorer verification of the Aevum deployment
	$(CONTRACTS) npm run verify:aevum

register: ## Register a merchant on Aevum (SLUG=demo-store PAYOUT=0x...)
	$(COMPOSE) run --rm -e MERCHANT_SLUG=$(SLUG) -e MERCHANT_PAYOUT=$(PAYOUT) contracts npm run register-merchant -- --network aevum

smoke: ## 0.10 tUSD8 test payment on Aevum (SLUG=demo-store AMOUNT=0.10)
	$(COMPOSE) run --rm -e MERCHANT_SLUG=$(or $(SLUG),demo-store) -e AMOUNT=$(or $(AMOUNT),0.10) contracts npm run smoke-pay -- --network aevum

status: ## Show the Aevum contract's roles, fee and pause state
	$(COMPOSE) run --rm -e ACTION=status contracts npm run admin -- --network aevum
