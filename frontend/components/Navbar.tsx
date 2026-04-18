'use client';

import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useState, useRef } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import Link from 'next/link';
import { clearOnboardedUser, getOnboardedUser, saveOnboardedUser } from '@/lib/onboarding-storage';
import { fetchUserProfileByWallet, UserProfile } from '@/lib/api';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { CopyValueButton } from '@/components/CopyValueButton';
import { UserAvatar } from '@/components/UserAvatar';
import { shortenAddress } from '@/lib/format';

export function Navbar() {
  const pathname = usePathname();
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setUser(null);
      setIsDropdownOpen(false);
      return;
    }

    const walletAddress = publicKey.toBase58();
    const onboardedUser = getOnboardedUser();

    if (onboardedUser?.wallet_address === walletAddress) {
      setUser(onboardedUser);
      return;
    }

    let isActive = true;

    async function loadUser() {
      try {
        const existingUser = await fetchUserProfileByWallet(walletAddress);

        if (!isActive) {
          return;
        }

        if (existingUser) {
          saveOnboardedUser(existingUser);
          setUser(existingUser);
          return;
        }

        clearOnboardedUser();
        setUser(null);
      } catch (error) {
        if (isActive) {
          console.error('Error loading onboarded user:', error);
          setUser(null);
        }
      }
    }

    void loadUser();

    return () => {
      isActive = false;
    };
  }, [connected, publicKey, pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (pathname === '/') return null;

  return (
    <nav className="fixed right-6 top-6 z-50 flex items-center gap-4">
      {connected ? (
        <div className="relative" ref={dropdownRef}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setIsDropdownOpen(!isDropdownOpen);
              }
            }}
            className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0D1B35]/80 p-1.5 pr-4 backdrop-blur-md transition hover:border-[#00C896]/50 hover:bg-[#132442] cursor-pointer"
          >
            <UserAvatar name={user ? user.username : '?'} className="h-9 w-9 text-sm" />
            <div className="text-left">
              <p className="text-xs font-medium text-white group-hover:text-[#00C896]">
                {user ? user.username : 'Unregistered'}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-[#6D82A8]">
                  {shortenAddress(publicKey?.toBase58() || '')}
                </p>
                {publicKey && (
                  <CopyValueButton
                    value={publicKey.toBase58()}
                    title="Copy wallet address"
                    className="h-6 w-6 border-transparent bg-transparent"
                  />
                )}
              </div>
            </div>
          </div>

          {isDropdownOpen && (
            <div className="absolute right-0 mt-3 w-56 origin-top-right rounded-2xl border border-white/10 bg-[#0D1B35] p-2 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-200">
              <div className="px-4 py-3">
                <p className="text-sm font-bold text-white">{user ? user.username : 'Unregistered'}</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="min-w-0 truncate text-xs text-[#6D82A8]">
                    {shortenAddress(publicKey?.toBase58() || '', 6, 6)}
                  </p>
                  {publicKey && (
                    <CopyValueButton
                      value={publicKey.toBase58()}
                      title="Copy wallet address"
                      className="h-7 w-7 shrink-0"
                    />
                  )}
                </div>
              </div>
              <div className="h-px bg-white/5 my-1" />
              
              {user ? (
                <>
                  <Link
                    href="/overview"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex w-full items-center rounded-xl px-4 py-2.5 text-sm text-[#D6DEEE] transition hover:bg-white/5 hover:text-[#00C896]"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href={`/u/${user.username}`}
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex w-full items-center rounded-xl px-4 py-2.5 text-sm text-[#D6DEEE] transition hover:bg-white/5 hover:text-[#00C896]"
                  >
                    Public Profile
                  </Link>
                </>
              ) : (
                <Link
                  href="/onboard"
                  onClick={() => setIsDropdownOpen(false)}
                  className="flex w-full items-center rounded-xl px-4 py-2.5 text-sm text-[#00C896] transition hover:bg-[#00C896]/10"
                >
                  Onboard Account
                </Link>
              )}
              
              <div className="h-px bg-white/5 my-1" />
              
              <button
                onClick={() => {
                  setVisible(true);
                  setIsDropdownOpen(false);
                }}
                className="flex w-full items-center rounded-xl px-4 py-2.5 text-sm text-[#D6DEEE] transition hover:bg-white/5 hover:text-[#00C896]"
              >
                Change Wallet
              </button>

              {publicKey && (
                <a
                  href={`https://solscan.io/account/${publicKey.toBase58()}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsDropdownOpen(false)}
                  className="flex w-full items-center rounded-xl px-4 py-2.5 text-sm text-[#D6DEEE] transition hover:bg-white/5 hover:text-[#00C896]"
                >
                  Show in Explorer
                  <span className="ml-auto text-[#6D82A8]">↗</span>
                </a>
              )}
              
              <button
                onClick={() => {
                  disconnect();
                  clearOnboardedUser();
                  setIsDropdownOpen(false);
                }}
                className="flex w-full items-center rounded-xl px-4 py-2.5 text-sm text-[#FF5F82] transition hover:bg-[#FF5F82]/10"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0D1B35]/50 p-1.5 backdrop-blur-md">
          {isMounted ? (
            <WalletConnectButton className="!h-10 !bg-[#00C896] !px-5 !text-xs !font-bold !text-[#0A0F1E] !rounded-xl !transition hover:!scale-105" />
          ) : (
            <button
              type="button"
              disabled
              className="!h-10 rounded-xl bg-[#00C896] px-5 text-xs font-bold text-[#0A0F1E] opacity-80"
            >
              Connect Wallet
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
