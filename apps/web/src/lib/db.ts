import { MongoClient, type Db } from "mongodb";
import { MemoryDb } from "@aevify/shared/testing";

/**
 * MongoDB access for the web app and API. Server-side only.
 *
 * Configure with MONGODB_URI (and optionally MONGODB_DB, default "aevify") in .env,
 * or in the Vercel project settings.
 */

/** Collection names, in one place so the API and listener agree. */
export const COLLECTIONS = {
  merchants: "merchants",
  apiKeys: "api_keys",
  payments: "payments",
  webhookDeliveries: "webhook_deliveries",
  listenerState: "listener_state",
} as const;

declare global {
  // One client per process: survives hot reloads in dev and warm invocations on Vercel.
  var _aevifyMongoClient: MongoClient | undefined;
  var _aevifyMemoryDb: MemoryDb | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("MONGODB_URI is not set. Add it to .env (see .env.example).");
    this.name = "DatabaseNotConfiguredError";
  }
}

/**
 * TEST ONLY: `AEVIFY_TEST_MODE=memory` swaps MongoDB for an in-memory store and enables a
 * test sign-in cookie, for automated browser tests. It can never turn on in production.
 */
export function isMemoryTestMode(): boolean {
  return process.env.AEVIFY_TEST_MODE === "memory" && process.env.NODE_ENV !== "production";
}

export function isDatabaseConfigured(): boolean {
  return isMemoryTestMode() || Boolean(process.env.MONGODB_URI?.trim());
}

/**
 * The shared MongoClient. The driver connects on first use and reconnects by itself,
 * so a temporary outage doesn't leave the app stuck.
 */
export function getMongoClient(): MongoClient {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new DatabaseNotConfiguredError();
  globalThis._aevifyMongoClient ??= new MongoClient(uri, {
    appName: "aevify-web",
    serverSelectionTimeoutMS: 5_000,
  });
  return globalThis._aevifyMongoClient;
}

/** The Aevify database. */
export function getDb(): Db {
  if (isMemoryTestMode()) {
    globalThis._aevifyMemoryDb ??= new MemoryDb();
    return globalThis._aevifyMemoryDb as unknown as Db;
  }
  return getMongoClient().db(process.env.MONGODB_DB?.trim() || "aevify");
}
