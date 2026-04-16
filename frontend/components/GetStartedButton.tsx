'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchUserProfileByWallet } from '@/lib/api';
import { saveOnboardedUser } from '@/lib/onboarding-storage';

export function GetStartedButton() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [isRouting, setIsRouting] = useState(false);

  async function handleClick() {
    if (isRouting) {
      return;
    }

    const walletAddress = publicKey?.toBase58();

    if (!walletAddress) {
      router.push('/onboard');
      return;
    }

    setIsRouting(true);

    try {
      const existingUser = await fetchUserProfileByWallet(walletAddress);

      if (existingUser) {
        saveOnboardedUser(existingUser);
        router.push('/overview');
        return;
      }

      router.push('/onboard');
    } catch (error) {
      console.error('Error checking wallet onboarding status:', error);
      router.push('/onboard');
    } finally {
      setIsRouting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isRouting}
      className="rounded-2xl bg-[#00C896] px-6 py-4 text-base font-bold text-[#0A0F1E] transition hover:bg-[#00B085] sm:min-w-44 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {isRouting ? 'Checking wallet...' : 'Get Started'}
    </button>
  );
}
