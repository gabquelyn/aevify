import { MongoClient, type Db } from "mongodb";

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
} as const;

declare global {
  // One client per process: survives hot reloads in dev and warm invocations on Vercel.
  var _aevifyMongoClient: MongoClient | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("MONGODB_URI is not set. Add it to .env (see .env.example).");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
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
  return getMongoClient().db(process.env.MONGODB_DB?.trim() || "aevify");
}
