'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { PaymentForm } from '@/components/PaymentForm';
import { CopyValueButton } from '@/components/CopyValueButton';
import { IconAvatar } from '@/components/IconPicker';
import { fetchUserProfile, type UserProfile } from '@/lib/api';
import { shortenAddress } from '@/lib/format';

type LookupState = 'idle' | 'searching' | 'found' | 'not-found' | 'error';

export default function SendPage() {
  const [recipientUsername, setRecipientUsername] = useState('');
  const [recipient, setRecipient] = useState<UserProfile | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>('idle');

  // Debounced username → profile lookup
  useEffect(() => {
    const normalized = recipientUsername.trim().toLowerCase().replace(/^@/, '');

    if (normalized.length < 3) {
      setRecipient(null);
      setLookupState('idle');
      return;
    }

    setLookupState('searching');

    const id = window.setTimeout(() => {
      void fetchUserProfile(normalized)
        .then((profile) => {
          if (!profile) { setRecipient(null); setLookupState('not-found'); return; }
          setRecipient(profile);
          setLookupState('found');
        })
        .catch(() => { setRecipient(null); setLookupState('error'); });
    }, 350);

    return () => window.clearTimeout(id);
  }, [recipientUsername]);

  const helperText = useMemo(() => {
    if (lookupState === 'searching') return 'Looking up this PayLink username…';
    if (lookupState === 'not-found') return 'No PayLink user found for that username.';
    if (lookupState === 'error')     return 'Could not resolve user right now. Please try again.';
    if (recipient) return `Resolved to ${shortenAddress(recipient.wallet_address, 6, 6)}.`;
    return 'Enter a PayLink username to prepare a USDC payment.';
  }, [lookupState, recipient]);

  return (
    <div className="flex flex-col gap-8">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">Send USDC</h1>
        <p className="mt-2 text-sm text-[#8896B3]">
          Search by PayLink username to resolve a wallet, then sign a direct USDC transfer
          from your connected wallet — or enter any Solana address directly.
        </p>
      </div>

      {/* ── Main panel ─────────────────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">

        {/* Left: recipient + payment form */}
        <section className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">One-time payout</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Send to a PayLink user</h2>
          <p className="mt-2 text-sm text-[#8896B3]">
            Search by username, confirm the resolved wallet, then sign the transfer with your
            connected wallet. You can also enter a raw Solana address below.
          </p>

          {/* Username search */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-[#0A0F1E] p-4 sm:p-5">
            <label htmlFor="send-recipient" className="text-sm font-medium text-white">
              Recipient username
            </label>
            <div className="mt-3 flex items-center rounded-2xl border border-[#1A2235] bg-[#081122] px-4">
              <span className="mr-2 text-lg text-[#00C896]">@</span>
              <input
                id="send-recipient"
                type="text"
                value={recipientUsername}
                onChange={(e) => setRecipientUsername(e.target.value)}
                placeholder="chukwuemeka"
                className="h-14 w-full bg-transparent text-white outline-none placeholder:text-[#53627F]"
              />
              {lookupState === 'searching' && (
                <Loader2 size={16} className="shrink-0 animate-spin text-[#8896B3]" />
              )}
              {lookupState === 'found' && (
                <BadgeCheck size={16} className="shrink-0 text-[#00C896]" />
              )}
            </div>
            <p className={`mt-2 text-xs ${
              lookupState === 'not-found' || lookupState === 'error'
                ? 'text-[#FF5F82]'
                : 'text-[#8896B3]'
            }`}>
              {helperText}
            </p>
          </div>

          {/* Resolved recipient card */}
          {recipient && lookupState === 'found' && (
            <div className="mt-5 rounded-2xl border border-[#1A2235] bg-[#0A1325] p-5 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <IconAvatar
                    iconKey={recipient.icon_key ?? 'zap'}
                    size={18}
                    className="h-14 w-14"
                  />
                  <div>
                    <p className="text-lg font-semibold text-white">{recipient.display_name}</p>
                    <p className="text-sm text-[#8896B3]">@{recipient.username}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0D1B35] px-3 py-2 text-sm text-[#D6DEEE]">
                  <span className="font-mono">{shortenAddress(recipient.wallet_address, 6, 6)}</span>
                  <CopyValueButton
                    value={recipient.wallet_address}
                    title="Copy recipient wallet"
                    className="h-7 w-7 border-transparent bg-transparent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Payment form */}
          <div className="mt-6">
            <PaymentForm
              recipientUsername={recipient?.username ?? ''}
              recipientWallet={recipient?.wallet_address ?? ''}
              fixedAmount={null}
            />
          </div>
        </section>

        {/* Right: info cards */}
        <section className="flex flex-col gap-4">
          <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">How it works</p>
            <div className="mt-4 flex flex-col gap-4 text-sm">
              {[
                {
                  step: '1',
                  title: 'Find recipient',
                  body: 'Type a PayLink username — it resolves to their USDC wallet automatically.',
                },
                {
                  step: '2',
                  title: 'Set amount',
                  body: 'Enter any amount in USDC. Add an optional memo for reference.',
                },
                {
                  step: '3',
                  title: 'Sign & send',
                  body: 'Your wallet signs the transaction. Solana confirms in seconds.',
                },
              ].map(({ step, title, body }) => (
                <div key={step} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#00C896]/15 text-xs font-bold text-[#00C896]">
                    {step}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{title}</p>
                    <p className="mt-1 text-[#8896B3]">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Want recurring payments?</p>
            <p className="mt-3 text-sm text-[#8896B3]">
              For scheduled, multi-employee payroll, use the{' '}
              <a href="/payroll" className="text-[#00C896] hover:underline">Payroll</a>{' '}
              feature. It supports weekly, bi-weekly, and monthly cadences with
              vault-based automation — no repeated signing required.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
