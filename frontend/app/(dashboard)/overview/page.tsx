"use client";

import { useEffect, useState } from "react";
import { useSolanaBalance } from "@/hooks/useSolanaBalance";
import { useRecentTransactions } from "@/hooks/useRecentTransactions";
import Link from "next/link";
import { getOnboardedUser } from "@/lib/onboarding-storage";
import type { UserProfile } from "@/lib/api";
import { CopyValueButton } from "@/components/CopyValueButton";
import { shortenAddress } from "@/lib/format";

export default function OverviewPage() {
  const { data: balance, isLoading } = useSolanaBalance();
  const { data: transactions, isLoading: isTxsLoading } =
    useRecentTransactions();
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    setUser(getOnboardedUser());
  }, []);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const paylinkUrl = user
    ? `${appUrl}/u/${user.username}`
    : "Connect wallet and onboard";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-[#8896B3]">
            Track balances, copy your payment page, and manage incoming
            activity.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-5 rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5 sm:p-6">
          <p className="text-[#8896B3] text-sm mb-1">Your Balances</p>
          <div className="flex flex-wrap gap-8">
            {(isLoading || (balance && balance.usdc > 0)) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-[#7BF0C9] mb-1">
                  USDC
                </p>
                <h2 className="text-3xl font-bold text-white sm:text-4xl">
                  {isLoading ? "..." : `$${balance?.usdc ?? 0}`}
                </h2>
              </div>
            )}
            {(isLoading || (balance && balance.sol > 0)) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-[#7BF0C9] mb-1">
                  Solana
                </p>
                <h2 className="text-3xl font-bold text-white sm:text-4xl">
                  {isLoading ? "..." : `${balance?.sol ?? 0} SOL`}
                </h2>
              </div>
            )}
            {!isLoading &&
              balance &&
              balance.usdc === 0 &&
              balance.sol === 0 && (
                <p className="text-white">No active balances found.</p>
              )}
          </div>
          <div className="mt-2 flex gap-3">
            <Link
              href="/offramp"
              className="inline-flex items-center justify-center rounded-xl bg-[#00C896] px-5 py-2.5 font-bold text-[#0A0F1E] transition-colors hover:bg-[#00B085]"
            >
              Off-Ramp
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5 sm:p-6">
          <p className="text-[#8896B3] text-sm mb-1">Your PayLink</p>
          <p className="text-white font-semibold mb-3">
            {user
              ? `@${user.username}`
              : "Finish onboarding to claim your link"}
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="break-all rounded-md bg-[#1A2235] px-3 py-2 text-sm text-[#00C896]">
              {paylinkUrl}
            </code>
            <CopyValueButton
              value={paylinkUrl}
              title="Copy PayLink URL"
              className="self-start rounded-lg border-[#22304D] bg-transparent"
            />
          </div>
          {user ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-[#8896B3]">
              <span>Wallet: {shortenAddress(user.wallet_address, 6, 6)}</span>
              <CopyValueButton
                value={user.wallet_address}
                title="Copy wallet address"
                className="h-7 w-7 border-transparent bg-transparent"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5 sm:p-6">
        <h3 className="font-semibold mb-4 text-lg text-white">
          Recent Activity
        </h3>
        <div className="flex flex-col gap-4">
          {isTxsLoading ? (
            <p className="text-sm text-[#8896B3]">Loading transactions...</p>
          ) : transactions && transactions.length > 0 ? (
            transactions.map((tx: any) => (
              <div
                key={tx.signature}
                className="flex flex-col gap-2 border-b border-[#1A2235] pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <a
                    href={`https://solscan.io/tx/${tx.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[#00C896] hover:underline truncate max-w-[200px] sm:max-w-xs"
                  >
                    {tx.signature}
                  </a>
                  <span className="text-xs text-[#8896B3]">{tx.time}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${tx.status === "Success" ? "bg-[#00C896]/10 text-[#00C896]" : "bg-[#FF5F82]/10 text-[#FF5F82]"}`}
                  >
                    {tx.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#8896B3]">
              No recent transactions found for this wallet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
