import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();
let supabaseClient: SupabaseClient | null = null;

export class DatabaseConnectionError extends Error {
  constructor(message = "Database is unreachable") {
    super(message);
    this.name = "DatabaseConnectionError";
  }
}

function getSupabaseUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL is not configured");
  }
  return url;
}

function getSupabaseKey() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    return serviceKey;
  }
  
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error("Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is configured");
  }
  
  console.warn("WARNING: Using SUPABASE_ANON_KEY in the backend. This may cause Row-Level Security (RLS) errors. Please configure SUPABASE_SERVICE_ROLE_KEY in your .env file to bypass RLS in the API.");
  return anonKey;
}

export function getDb() {
  if (!supabaseClient) {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();

    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

export async function assertDatabaseConnection() {
  try {
    const db = getDb();
    // Test connection by fetching a single row
    const { error } = await db.from("users").select("id").limit(1);

    if (error) {
      throw error;
    }
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}

export function normalizeDatabaseError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String(error.message);
    if (message.includes("fetch")) {
      return new DatabaseConnectionError(
        "Cannot connect to Supabase. Check SUPABASE_URL and SUPABASE_ANON_KEY.",
      );
    }
  }

  return error;
}

// Export Supabase client directly for use in services
export const supabase = getDb();
