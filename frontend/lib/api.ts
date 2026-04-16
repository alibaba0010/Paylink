import axios from 'axios';

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  wallet_address: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  total_payments: number;
  total_volume_usdc: number;
  default_link_id: string;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
}

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001',
});

export { api };

export async function fetchUserProfile(username: string) {
  try {
    const { data } = await api.get<{ success: boolean; user: UserProfile }>(
      `/users/${username}`
    );

    return data.user;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function fetchUserProfileByWallet(walletAddress: string) {
  try {
    const { data } = await api.get<{ success: boolean; user: UserProfile }>(
      `/users/by-wallet/${walletAddress}`
    );

    return data.user;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function onboardUser(payload: {
  username: string;
  walletAddress: string;
}) {
  const { data } = await api.post<{ success: boolean; user: UserProfile }>(
    '/onboard',
    payload
  );

  return data.user;
}

export async function checkUsernameAvailability(username: string) {
  const { data } = await api.get<{ success: boolean; available: boolean }>(
    `/users/available/${username}`
  );

  return data.available;
}
