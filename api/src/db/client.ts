import dns from "node:dns";
import { Pool } from "pg";

let pool: Pool | null = null;

// Prefer IPv6 — nc confirms Supabase direct DB is reachable over IPv6.
dns.setDefaultResultOrder("ipv6first");

const CONNECTION_ERROR_CODES = new Set([
  "ENETUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
]);

export class DatabaseConnectionError extends Error {
  constructor(message = "Database is unreachable") {
    super(message);
    this.name = "DatabaseConnectionError";
  }
}

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return connectionString;
}

export function getDb() {
  if (!pool) {
    const connectionString = getConnectionString();
    const isLocal =
      connectionString.includes("localhost") ||
      connectionString.includes("127.0.0.1");

    pool = new Pool({
      connectionString,
      // Supabase direct connection requires SSL; rejectUnauthorized: false
      // accepts the self-signed cert on db.*.supabase.co
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,  // fail fast if the host is unreachable
      idleTimeoutMillis: 30_000,
      max: 5,
    });
  }

  return pool;
}

export async function assertDatabaseConnection() {
  try {
    await getDb().query("SELECT 1");
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}

export function normalizeDatabaseError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    CONNECTION_ERROR_CODES.has(String(error.code))
  ) {
    return new DatabaseConnectionError(
      "Database connection failed. Check your DATABASE_URL or ensure your environment supports IPv6.",
    );
  }

  return error;
}
