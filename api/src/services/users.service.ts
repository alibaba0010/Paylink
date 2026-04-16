import { PublicKey } from "@solana/web3.js";
import { getDb, normalizeDatabaseError } from "../db/client";

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
      "Username must be 3-20 characters using lowercase letters, numbers, or underscores"
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
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;
    const db = getDb();

    try {
      const result = await db.query<DbUserRow>(
        `
          INSERT INTO users (username, display_name, wallet_address, avatar_url)
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            username,
            display_name,
            wallet_address,
            avatar_url,
            bio,
            is_verified,
            total_payments,
            total_received AS total_volume_usdc,
            twitter,
            github,
            linkedin
        `,
        [username, username, walletAddress, avatarUrl]
      );

      return toPublicUserProfile(result.rows[0]);
    } catch (error: any) {
      if (error?.code === "23505") {
        if (
          typeof error.constraint === "string" &&
          error.constraint.includes("wallet")
        ) {
          throw new UserConflictError("Wallet address is already onboarded");
        }

        throw new UserConflictError("Username is already taken");
      }

      throw normalizeDatabaseError(error);
    }
  }

  async getUserByUsername(usernameInput: string) {
    const username = validateUsername(usernameInput);
    const db = getDb();

    let result;

    try {
      result = await db.query<DbUserRow>(
        `
          SELECT
            id,
            username,
            display_name,
            wallet_address,
            avatar_url,
            bio,
            is_verified,
            total_payments,
            total_received AS total_volume_usdc,
            twitter,
            github,
            linkedin
          FROM users
          WHERE username = $1
          LIMIT 1
        `,
        [username]
      );
    } catch (error) {
      throw normalizeDatabaseError(error);
    }

    if (result.rowCount === 0) {
      return null;
    }

    return toPublicUserProfile(result.rows[0]);
  }

  async getUserByWalletAddress(walletAddressInput: string) {
    const walletAddress = validateWalletAddress(walletAddressInput);
    const db = getDb();

    let result;

    try {
      result = await db.query<DbUserRow>(
        `
          SELECT
            id,
            username,
            display_name,
            wallet_address,
            avatar_url,
            bio,
            is_verified,
            total_payments,
            total_received AS total_volume_usdc,
            twitter,
            github,
            linkedin
          FROM users
          WHERE wallet_address = $1
          LIMIT 1
        `,
        [walletAddress]
      );
    } catch (error) {
      throw normalizeDatabaseError(error);
    }

    if (result.rowCount === 0) {
      return null;
    }

    return toPublicUserProfile(result.rows[0]);
  }

  async isUsernameAvailable(usernameInput: string): Promise<boolean> {
    try {
      const username = validateUsername(usernameInput);
      const db = getDb();
      const result = await db.query(
        "SELECT 1 FROM users WHERE username = $1 LIMIT 1",
        [username]
      );
      return result.rowCount === 0;
    } catch (error) {
      if (error instanceof UserInputError) {
        return false;
      }
      throw normalizeDatabaseError(error);
    }
  }
}
