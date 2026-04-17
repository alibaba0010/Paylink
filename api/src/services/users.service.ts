import { PublicKey } from "@solana/web3.js";
import { supabase, DatabaseConnectionError } from "../db/supabase-client";

export interface PublicUserProfile {
  id: string;
  username: string;
  display_name: string;
  wallet_address: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  total_payments: number;
  total_volume_usdc: number;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
  default_link_id: string;
}

interface OnboardInput {
  username: string;
  walletAddress: string;
}

interface DbUserRow {
  id: string;
  username: string;
  display_name: string;
  wallet_address: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  total_payments: number;
  total_volume_usdc: string | number | null;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
}

export class UserInputError extends Error {}
export class UserConflictError extends Error {}

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function normalizeUsername(input: string) {
  return input.trim().toLowerCase();
}

function validateWalletAddress(walletAddress: string) {
  try {
    return new PublicKey(walletAddress.trim()).toBase58();
  } catch {
    throw new UserInputError("Wallet address is invalid");
  }
}

function validateUsername(username: string) {
  const normalizedUsername = normalizeUsername(username);

  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    throw new UserInputError(
      "Username must be 3-20 characters using lowercase letters, numbers, or underscores",
    );
  }

  return normalizedUsername;
}

function toPublicUserProfile(row: DbUserRow): PublicUserProfile {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    wallet_address: row.wallet_address,
    avatar_url: row.avatar_url,
    bio: row.bio,
    is_verified: row.is_verified,
    total_payments: row.total_payments,
    total_volume_usdc: Number(row.total_volume_usdc ?? 0),
    twitter: row.twitter,
    github: row.github,
    linkedin: row.linkedin,
    default_link_id: `user_${row.username}`,
  };
}

export class UsersService {
  async createUser(input: OnboardInput) {
    const username = validateUsername(input.username);
    const walletAddress = validateWalletAddress(input.walletAddress);

    // Check for existing users before attempting insert to return proper conflict errors,
    // as Supabase RLS might throw a generic 42501 policy violation instead of 23505 unique violation.
    const existingWalletUser = await this.getUserByWalletAddress(walletAddress);
    if (existingWalletUser) {
      throw new UserConflictError("Wallet address is already onboarded");
    }

    const isUsernameAvail = await this.isUsernameAvailable(username);
    if (!isUsernameAvail) {
      throw new UserConflictError("Username is already taken");
    }

    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;

    try {
      const { data, error } = await supabase
        .from("users")
        .insert({
          username,
          display_name: username,
          wallet_address: walletAddress,
          avatar_url: avatarUrl,
        })
        .select(
          "id, username, display_name, wallet_address, avatar_url, bio, is_verified, total_payments, total_volume_usdc:total_received, twitter, github, linkedin",
        )
        .single();

      if (error) {
        throw error;
      }

      return toPublicUserProfile(data as unknown as DbUserRow);
    } catch (error: any) {
      if (error?.code === "23505") {
        if (error.message?.includes("wallet")) {
          throw new UserConflictError("Wallet address is already onboarded");
        }

        throw new UserConflictError("Username is already taken");
      }

      // Handle RLS errors explicitly if they still occur
      if (error?.code === "42501" || error?.message?.includes("row-level security")) {
        throw new DatabaseConnectionError(
           "Could not create user due to database security policies. If you are inserting a new user, please check Supabase RLS policies."
        );
      }

      throw new DatabaseConnectionError(
        error?.message || "Failed to create user",
      );
    }
  }

  async getUserByUsername(usernameInput: string) {
    const username = validateUsername(usernameInput);

    try {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, username, display_name, wallet_address, avatar_url, bio, is_verified, total_payments, total_volume_usdc:total_received, twitter, github, linkedin",
        )
        .eq("username", username)
        .limit(1)
        .single();

      if (error?.code === "PGRST116") {
        // No rows found
        return null;
      }

      if (error) {
        throw error;
      }

      return toPublicUserProfile(data as unknown as DbUserRow);
    } catch (error: any) {
      if (error?.code === "PGRST116") {
        return null;
      }

      throw new DatabaseConnectionError(
        error?.message || "Failed to fetch user",
      );
    }
  }

  async getUserByWalletAddress(walletAddressInput: string) {
    const walletAddress = validateWalletAddress(walletAddressInput);

    try {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, username, display_name, wallet_address, avatar_url, bio, is_verified, total_payments, total_volume_usdc:total_received, twitter, github, linkedin",
        )
        .eq("wallet_address", walletAddress)
        .limit(1)
        .single();

      if (error?.code === "PGRST116") {
        // No rows found
        return null;
      }

      if (error) {
        throw error;
      }

      return toPublicUserProfile(data as unknown as DbUserRow);
    } catch (error: any) {
      if (error?.code === "PGRST116") {
        return null;
      }

      throw new DatabaseConnectionError(
        error?.message || "Failed to fetch user",
      );
    }
  }

  async isUsernameAvailable(usernameInput: string): Promise<boolean> {
    try {
      const username = validateUsername(usernameInput);
      const { data, error } = await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .limit(1);

      if (error) {
        throw error;
      }

      return !data || data.length === 0;
    } catch (error: any) {
      if (error instanceof UserInputError) {
        return false;
      }
      throw new DatabaseConnectionError(
        error?.message || "Failed to check username availability",
      );
    }
  }
}
