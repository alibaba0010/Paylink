'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { onboardUser, checkUsernameAvailability, fetchUserProfileByWallet } from '@/lib/api';
import { saveOnboardedUser } from '@/lib/onboarding-storage';
import { BrandLogo } from '@/components/BrandLogo';
import { WalletConnectButton } from '@/components/WalletConnectButton';

function normalizeUsername(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
}

export default function OnboardPage() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const [username, setUsername] = useState('');
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingExistingUser, setIsCheckingExistingUser] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? '';

  useEffect(() => {
    if (!walletAddress) {
      setIsCheckingExistingUser(false);
      return;
    }

    let isActive = true;

    async function loadExistingUser() {
      setIsCheckingExistingUser(true);

      try {
        const existingUser = await fetchUserProfileByWallet(walletAddress);

        if (!isActive || !existingUser) {
          return;
        }

        saveOnboardedUser(existingUser);
        router.replace('/overview');
      } catch (error) {
        if (isActive) {
          console.error('Error checking existing wallet onboarding:', error);
        }
      } finally {
        if (isActive) {
          setIsCheckingExistingUser(false);
        }
      }
    }

    void loadExistingUser();

    return () => {
      isActive = false;
    };
  }, [walletAddress, router]);

  useEffect(() => {
    if (username.length < 3 || isCheckingExistingUser) {
      setIsAvailable(null);
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    const timeout = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailability(username);
        setIsAvailable(available);
      } catch (error) {
        console.error('Error checking availability:', error);
      } finally {
        setIsValidating(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [username]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();

    if (!walletAddress) {
      setErrorMessage('Connect a wallet before continuing.');
      return;
    }

    if (!username || username.length < 3) {
      setErrorMessage('Username must be at least 3 characters.');
      return;
    }

    if (isAvailable === false) {
      setErrorMessage('This username is already taken. Please choose another one.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const user = await onboardUser({
        username,
        walletAddress,
      });

      saveOnboardedUser(user);
      router.push('/overview');
    } catch (error: any) {
      setErrorMessage(
        error?.response?.data?.message ||
          'We could not complete onboarding. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#133055_0%,_#0A0F1E_48%,_#050814_100%)] px-4 py-10 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:items-stretch">
        <section className="flex-1 rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur sm:p-8 lg:p-10">
          <BrandLogo />

          <div className="mt-8 max-w-xl sm:mt-10">
            <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#00C896]">
              Creator onboarding
            </p>
            <h1 className="font-[Space_Grotesk] text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">
              Claim your username and connect the wallet you want to get paid with.
            </h1>
            <p className="mt-4 text-base leading-7 text-[#A9B7D3]">
              Your username becomes your public PayLink URL. We save the username and
              the connected wallet address through the API, and the username must be
              unique.
            </p>
          </div>

          <div className="mt-8 grid gap-4 text-sm text-[#D6DEEE] sm:mt-10 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4">
              <p className="text-[#00C896]">1</p>
              <p className="mt-2 font-semibold text-white">Connect wallet</p>
              <p className="mt-2 text-[#8EA0C5]">Use Phantom or Solflare to attach the payout wallet.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4">
              <p className="text-[#00C896]">2</p>
              <p className="mt-2 font-semibold text-white">Choose username</p>
              <p className="mt-2 text-[#8EA0C5]">Lowercase letters, numbers, and underscores only.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4">
              <p className="text-[#00C896]">3</p>
              <p className="mt-2 font-semibold text-white">Start receiving</p>
              <p className="mt-2 text-[#8EA0C5]">We take you straight to your dashboard when onboarding succeeds.</p>
            </div>
          </div>
        </section>

        <section className="w-full max-w-xl rounded-[28px] border border-[#193055] bg-[#081122]/95 p-5 shadow-2xl shadow-black/30 sm:p-8">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.25em] text-[#6D82A8]">
              /onboard
            </p>
            <h2 className="mt-3 font-[Space_Grotesk] text-2xl font-bold sm:text-3xl">
              Set up your PayLink
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="rounded-2xl border border-[#193055] bg-[#0D1B35] p-5">
              <p className="mb-4 text-sm text-[#8EA0C5]">Wallet connection</p>
              <WalletConnectButton className="!h-12 !w-full !rounded-xl !bg-[#00C896] !text-base !font-bold !text-[#0A0F1E]" />
              <div className="mt-4 rounded-xl border border-white/10 bg-[#081122] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[#6D82A8]">
                  Connected address
                </p>
                <p className="mt-2 break-all font-mono text-sm text-white">
                  {walletAddress || 'No wallet connected yet'}
                </p>
              </div>
            </div>

            <label className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#D6DEEE]">Username</span>
                {username.length >= 3 && (
                  <div className="flex items-center gap-2 text-xs">
                    {isValidating ? (
                      <span className="text-[#8EA0C5]">Checking...</span>
                    ) : isAvailable === true ? (
                      <span className="font-bold text-[#00C896]">Available</span>
                    ) : isAvailable === false ? (
                      <span className="font-bold text-[#FF5F82]">Taken</span>
                    ) : null}
                  </div>
                )}
              </div>
              <div
                className={`rounded-2xl border bg-[#0D1B35] px-4 py-3 transition-colors ${
                  isAvailable === true
                    ? 'border-[#00C896]/50'
                    : isAvailable === false
                    ? 'border-[#FF5F82]/50'
                    : 'border-[#193055] focus-within:border-[#00C896]'
                }`}
              >
                <span className="break-all text-sm text-[#6D82A8]">paylink / u / </span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => {
                    setUsername(normalizeUsername(event.target.value));
                    setErrorMessage('');
                  }}
                  placeholder="jane_builder"
                  className="mt-2 w-full bg-transparent text-lg text-white outline-none placeholder:text-[#4E638A]"
                />
              </div>
              <span className="text-xs text-[#6D82A8]">
                3-20 characters. We store usernames in lowercase so each public link stays consistent.
              </span>
            </label>

            {errorMessage ? (
              <div className="rounded-2xl border border-[#6A1B2D] bg-[#2B1120] px-4 py-3 text-sm text-[#FFB4C2]">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={
                !connected ||
                isSubmitting ||
                isCheckingExistingUser ||
                isAvailable === false ||
                username.length < 3
              }
              className="rounded-2xl bg-[#00C896] px-5 py-4 text-lg font-bold text-[#081122] transition hover:bg-[#00B085] disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale-[0.5]"
            >
              {isCheckingExistingUser
                ? 'Checking your wallet...'
                : isSubmitting
                ? 'Saving your profile...'
                : 'Complete onboarding'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
