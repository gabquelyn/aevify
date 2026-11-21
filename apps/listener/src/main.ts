/**
 * Entry point: `npm run dev` (Docker) or `node dist/main.js` (Railway).
 * Runs the listener loop and a tiny health endpoint (GET /health) for the host's checks.
 */
import { createServer } from "node:http";
import { aevumChain } from "@aevify/shared";
import { MongoClient } from "mongodb";
import { createPublicClient, getAddress, http } from "viem";
import { createListener } from "./listener.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[listener] Missing ${name}. See .env.example and DEPLOY.md.`);
    process.exit(1);
  }
  return value;
}

const config = {
  mongoUri: required("MONGODB_URI"),
  mongoDb: process.env.MONGODB_DB?.trim() || "aevify",
  rpcUrl: required("AEVUM_RPC_URL"),
  chainId: Number(process.env.AEVUM_CHAIN_ID ?? 44005),
  checkout: getAddress(required("AEVIFY_CHECKOUT_ADDRESS")),
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  pollMs: Number(process.env.LISTENER_POLL_MS ?? 3000),
  confirmations: Number(process.env.LISTENER_CONFIRMATIONS ?? 1),
  batchBlocks: Number(process.env.LISTENER_BATCH_BLOCKS ?? 2000),
  startBlock: process.env.LISTENER_START_BLOCK ? BigInt(process.env.LISTENER_START_BLOCK) : undefined,
  // Private/local webhook URLs are only allowed outside production (e.g. http://host.docker.internal).
  allowPrivateWebhookUrls: process.env.NODE_ENV !== "production" && process.env.LISTENER_ALLOW_PRIVATE_WEBHOOKS !== "false",
  port: Number(process.env.PORT ?? 8080),
};

const mongo = new MongoClient(config.mongoUri, { appName: "aevify-listener" });
const publicClient = createPublicClient({ chain: aevumChain(config.rpcUrl, config.chainId), transport: http(config.rpcUrl) });
const listener = createListener({
  db: mongo.db(config.mongoDb),
  publicClient,
  checkoutAddress: config.checkout,
  chainId: config.chainId,
  appUrl: config.appUrl,
  confirmations: config.confirmations,
  batchBlocks: config.batchBlocks,
  startBlock: config.startBlock,
  allowPrivateWebhookUrls: config.allowPrivateWebhookUrls,
});

let lastTick: { at: Date; ok: boolean; error?: string } | null = null;
let stopping = false;

const server = createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  const status = await listener.status().catch(() => null);
  const healthy = Boolean(lastTick?.ok) && Date.now() - (lastTick?.at.getTime() ?? 0) < Math.max(60_000, config.pollMs * 10);
  res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ service: "aevify-listener", healthy, lastTick, ...status }));
});

async function run() {
  await listener.ensureIndexes();
  console.log(`[listener] Watching ${config.checkout} on chain ${config.chainId}, every ${config.pollMs}ms`);
  server.listen(config.port, () => console.log(`[listener] Health check on :${config.port}/health`));
  while (!stopping) {
    try {
      const result = await listener.tick();
      lastTick = { at: new Date(), ok: true };
      if (result.events || result.expired || result.sent) console.log("[listener] tick", result);
    } catch (error) {
      lastTick = { at: new Date(), ok: false, error: (error as Error).message };
      console.error("[listener] Tick failed (will retry):", (error as Error).message);
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

async function shutdown(signal: string) {
  console.log(`[listener] ${signal} received, stopping…`);
  stopping = true;
  server.close();
  await mongo.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

run().catch((error) => {
  console.error("[listener] Fatal:", error);
  process.exit(1);
});
