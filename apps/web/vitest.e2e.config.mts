import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * End-to-end tests against a real local chain (see test-e2e/flow.test.ts):
 *   docker compose up -d chain
 *   docker compose run --rm contracts npm run deploy:local
 *   docker compose run --rm -w /app/apps/web -e E2E_RPC_URL=http://chain:8545 contracts npm run test:e2e
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test-e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
