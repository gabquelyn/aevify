import { MongoClient, type Db } from "mongodb";

/**
 * MongoDB access for the web app and API. Server-side only: never import this from a
 * client component.
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
  // Cached across hot reloads in dev and across warm invocations on Vercel.
  var _aevifyMongoClient: Promise<MongoClient> | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("MONGODB_URI is not set. Add it to .env (see .env.example).");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new DatabaseNotConfiguredError();

  if (!globalThis._aevifyMongoClient) {
    const client = new MongoClient(uri, {
      appName: "aevify-web",
      serverSelectionTimeoutMS: 5_000,
    });
    globalThis._aevifyMongoClient = client.connect().catch((error: unknown) => {
      // Don't cache a failed connection; the next request will try again.
      globalThis._aevifyMongoClient = undefined;
      throw error;
    });
  }
  return globalThis._aevifyMongoClient;
}

/** The Aevify database. Connects on first use and reuses the connection afterwards. */
export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || "aevify");
}
