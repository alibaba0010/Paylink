"use client";

import { useCallback, useEffect, useState } from "react";
import { useSolanaBalance } from "@/hooks/useSolanaBalance";
import { useRecentTransactions } from "@/hooks/useRecentTransactions";
import Link from "next/link";
import { getOnboardedUser } from "@/lib/onboarding-storage";
import { fetchClaimablePayments, fetchReputationScore, getAppUrl, claimPayment, requestGaslessClaim, type ScheduledPaymentClaim, type UserProfile, type ReputationScore } from "@/lib/api";
import { CopyValueButton } from "@/components/CopyValueButton";
import { shortenAddress } from "@/lib/format";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { SendTransactionError } from "@solana/web3.js";
import { ReputationBadge } from "@/components/ReputationBadge";
import { Loader2, CheckCircle2, AlertTriangle, Wallet } from "lucide-react";

export default function OverviewPage() {
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { data: balance, isLoading } = useSolanaBalance();
  const { data: transactions, isLoading: isTxsLoading } =
    useRecentTransactions();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [scheduledClaims, setScheduledClaims] = useState<ScheduledPaymentClaim[]>([]);
  const [isLoadingClaims, setIsLoadingClaims] = useState(false);
  const [reputation, setReputation] = useState<ReputationScore | null>(null);
  const [claimingClaimId, setClaimingClaimId] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    const u = getOnboardedUser();
    setUser(u);
    if (u?.username) {
      fetchReputationScore(u.username).then(setReputation);
    }
  }, []);

  useEffect(() => {
    const wallet = publicKey?.toBase58();
    if (!wallet) {
      setScheduledClaims([]);
      return;
    }

    setIsLoadingClaims(true);
    fetchClaimablePayments(wallet)
      .then(setScheduledClaims)
      .catch(() => setScheduledClaims([]))
      .finally(() => setIsLoadingClaims(false));
  }, [publicKey]);

  const submitWalletTransaction = useCallback(async (tx: Transaction) => {
    if (!publicKey) throw new Error('Wallet not connected');
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = publicKey;
    tx.recentBlockhash = latest.blockhash;
    try {
      if (signTransaction) {
        const signedTx = await signTransaction(tx);
        const derivedSigBytes =
          signedTx.signature ??
          signedTx.signatures.find(({ publicKey: signer }) => signer.equals(publicKey))?.signature ??
          signedTx.signatures[0]?.signature ?? null;
        const derivedSig = derivedSigBytes ? bs58.encode(derivedSigBytes) : null;
        let sig = derivedSig;
        try {
          sig = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3,
          });
        } catch (err: any) {
          if (!String(err?.message || '').includes('already been processed') || !derivedSig) throw err;
          sig = derivedSig;
        }
        if (!sig) throw new Error('Signed transaction signature could not be derived');
        await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
        return sig;
      }
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
      await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
      return sig;
    } catch (err: any) {
      const message = err?.cause?.message || err?.message || 'Wallet failed to sign and send the transaction';
      throw new Error(message);
    }
  }, [connection, publicKey, sendTransaction, signTransaction]);

  async function handleClaimPayment(claimId: string) {
    const wallet = publicKey?.toBase58();
    if (!wallet) return;
    setClaimingClaimId(claimId);
    setClaimError(null);
    setClaimSuccess(null);
    try {
      const txBase64 = await requestGaslessClaim(claimId, wallet);
      const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
      const sig = await submitWalletTransaction(tx);
      await claimPayment(claimId, wallet, sig);
      setScheduledClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'claimed', can_claim: false } : c));
      setClaimSuccess('Funds claimed successfully! ✅');
    } catch (err: any) {
      setClaimError(err?.response?.data?.message || err?.message || 'Failed to claim payment');
    } finally {
      setClaimingClaimId(null);
    }
  }

  const appUrl = getAppUrl();
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

      {reputation && (
        <div className="w-full">
          <ReputationBadge reputation={reputation} />
        </div>
      )}

      <div className="rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5 sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
          <Wallet size={20} className="text-[#00C896]" />
          Scheduled Incoming Payments
        </h3>

        {claimSuccess && (
          <div className="mb-4 rounded-xl bg-[#00C896]/10 border border-[#00C896]/20 px-4 py-3 flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 size={16} className="text-[#00C896] shrink-0" />
            <p className="text-sm font-bold text-[#00C896]">{claimSuccess}</p>
          </div>
        )}
        {claimError && (
          <div className="mb-4 rounded-xl bg-[#FF5F82]/10 border border-[#FF5F82]/20 px-4 py-3 flex items-center gap-2 animate-in fade-in">
            <AlertTriangle size={16} className="text-[#FF5F82] shrink-0" />
            <p className="text-sm font-bold text-[#FF5F82]">{claimError}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {isLoadingClaims ? (
            <p className="text-sm text-[#8896B3]">Loading scheduled payments...</p>
          ) : scheduledClaims.length > 0 ? (
            scheduledClaims.map((claim) => {
              const title = claim.payroll_schedules?.title || "Payroll payment";
              const unlockDate = new Date(claim.claimable_at);
              const isClaimed = claim.status === "claimed";
              const isCancelled = claim.status === "cancelled";
              const statusLabel =
                isClaimed ? "Claimed" :
                isCancelled ? "Rejected" :
                claim.can_claim ? "Ready to claim" :
                `Locked until ${unlockDate.toLocaleDateString()}`;

              return (
                <div key={claim.id} className="flex flex-col gap-3 rounded-xl border border-[#1A2235] bg-[#0A0F1E]/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-white">{title}</p>
                    <p className="mt-1 text-sm text-[#8896B3]">
                      ${Number(claim.amount_usdc).toFixed(2)} · {statusLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`self-start rounded-full px-3 py-1 text-xs font-bold sm:self-auto ${
                      isClaimed ? "bg-[#00C896]/10 text-[#00C896]" :
                      isCancelled ? "bg-[#FF5F82]/10 text-[#FF5F82]" :
                      claim.can_claim ? "bg-amber-500/10 text-amber-300" :
                      "bg-[#1A2235] text-[#8896B3]"
                    }`}>
                      {isClaimed ? "Claimed" : isCancelled ? "Rejected" : claim.can_claim ? "Available" : "Locked"}
                    </span>
                    {claim.can_claim && !isClaimed && !isCancelled && (
                      <button
                        onClick={() => handleClaimPayment(claim.id)}
                        disabled={claimingClaimId === claim.id}
                        className="ml-1 bg-[#00C896] hover:bg-[#00B085] text-[#0A0F1E] font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-lg shadow-[#00C896]/20 active:scale-95"
                      >
                        {claimingClaimId === claim.id ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
                        {claimingClaimId === claim.id ? 'Claiming...' : 'Claim'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[#8896B3]">
              No scheduled incoming payments yet.
            </p>
          )}
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
                    href={`https://solscan.io/tx/${tx.signature}?cluster=devnet`}
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
