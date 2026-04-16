'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleAlert, SendHorizontal, Users } from 'lucide-react';
import { PaymentForm } from '@/components/PaymentForm';
import { CopyValueButton } from '@/components/CopyValueButton';
import { fetchUserProfile, type UserProfile } from '@/lib/api';
import { shortenAddress } from '@/lib/format';

type LookupState = 'idle' | 'searching' | 'found' | 'not-found' | 'error';

const frequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export default function PayrollPage() {
  const [recipientUsername, setRecipientUsername] = useState('');
  const [recipient, setRecipient] = useState<UserProfile | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>('idle');
  const [scheduleFrequency, setScheduleFrequency] = useState('monthly');

  useEffect(() => {
    const normalizedUsername = recipientUsername.trim().toLowerCase().replace(/^@/, '');

    if (normalizedUsername.length < 3) {
      setRecipient(null);
      setLookupState('idle');
      return;
    }

    setLookupState('searching');

    const timeoutId = window.setTimeout(() => {
      void fetchUserProfile(normalizedUsername)
        .then((profile) => {
          if (!profile) {
            setRecipient(null);
            setLookupState('not-found');
            return;
          }

          setRecipient(profile);
          setLookupState('found');
        })
        .catch((error) => {
          console.error('Failed to resolve payroll recipient:', error);
          setRecipient(null);
          setLookupState('error');
        });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [recipientUsername]);

  const helperText = useMemo(() => {
    if (lookupState === 'searching') {
      return 'Looking up this PayLink username...';
    }

    if (lookupState === 'not-found') {
      return 'No PayLink user found for that username yet.';
    }

    if (lookupState === 'error') {
      return 'We could not load that user right now. Please try again.';
    }

    if (recipient) {
      return `Resolved to ${shortenAddress(recipient.wallet_address, 6, 6)}.`;
    }

    return 'Enter a PayLink username to prepare a direct USDC payment.';
  }, [lookupState, recipient]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">Payroll</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#8896B3]">
            Send USDC to a PayLink user now, then build up to recurring weekly, bi-weekly, or monthly runs.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#00C896]/15 text-[#00C896]">
            <SendHorizontal size={18} />
          </div>
          <p className="text-sm font-semibold text-white">Direct payouts</p>
          <p className="mt-2 text-sm text-[#8896B3]">
            Resolve a username to a wallet and sign a USDC payment from your connected wallet.
          </p>
        </div>
        <div className="rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD166]/15 text-[#FFD166]">
            <CalendarClock size={18} />
          </div>
          <p className="text-sm font-semibold text-white">Recurring schedules</p>
          <p className="mt-2 text-sm text-[#8896B3]">
            The scheduling UI is ready for weekly, bi-weekly, and monthly payroll setup next.
          </p>
        </div>
        <div className="rounded-2xl border border-[#1A2235] bg-[#0D1B35] p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
            <Users size={18} />
          </div>
          <p className="text-sm font-semibold text-white">Recipient-first flow</p>
          <p className="mt-2 text-sm text-[#8896B3]">
            This follows the implementation doc direction: add workers, resolve them, then schedule payroll against the saved recipient.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">One-time payout</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Send USDC to a PayLink user</h2>
              <p className="mt-2 text-sm text-[#8896B3]">
                Search by username, confirm the resolved wallet, then sign the transfer with your connected wallet.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-[#0A0F1E] p-4 sm:p-5">
            <label htmlFor="recipient-username" className="text-sm font-medium text-white">
              Recipient username
            </label>
            <div className="mt-3 flex items-center rounded-2xl border border-[#1A2235] bg-[#081122] px-4">
              <span className="mr-2 text-lg text-[#00C896]">@</span>
              <input
                id="recipient-username"
                type="text"
                value={recipientUsername}
                onChange={(event) => setRecipientUsername(event.target.value)}
                placeholder="chukwuemeka"
                className="h-14 w-full bg-transparent text-white outline-none placeholder:text-[#53627F]"
              />
            </div>
            <p className="mt-3 text-sm text-[#8896B3]">{helperText}</p>
          </div>

          {recipient ? (
            <div className="mt-5 rounded-2xl border border-[#1A2235] bg-[#0A1325] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-[#081122]">
                    {recipient.avatar_url ? (
                      <img src={recipient.avatar_url} alt={recipient.username} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#00C896] font-bold text-[#0A0F1E]">
                        {recipient.username[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{recipient.display_name}</p>
                    <p className="text-sm text-[#8896B3]">@{recipient.username}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0D1B35] px-3 py-2 text-sm text-[#D6DEEE]">
                  <span>{shortenAddress(recipient.wallet_address, 6, 6)}</span>
                  <CopyValueButton
                    value={recipient.wallet_address}
                    title="Copy recipient wallet"
                    className="h-7 w-7 border-transparent bg-transparent"
                  />
                </div>
              </div>

              <div className="mt-5">
                <PaymentForm
                  recipientUsername={recipient.username}
                  recipientWallet={recipient.wallet_address}
                  fixedAmount={null}
                />
              </div>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-6">
          <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Recurring payroll</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Scheduling scaffold</h2>
            <p className="mt-2 text-sm text-[#8896B3]">
              The UI is aligned with the implementation doc and ready for the API routes in the next step.
            </p>

            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-[#0A0F1E] p-4">
                <label className="text-sm text-white">Frequency</label>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {frequencyOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setScheduleFrequency(option.value)}
                      className={`rounded-xl border px-3 py-3 text-sm transition ${
                        scheduleFrequency === option.value
                          ? 'border-[#00C896] bg-[#00C896]/10 text-[#00C896]'
                          : 'border-[#1A2235] bg-[#081122] text-[#8896B3] hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-[#2C3B5E] bg-[#081122] p-4">
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 text-[#FFD166]" size={18} />
                  <div>
                    <p className="text-sm font-medium text-white">Next implementation slice</p>
                    <p className="mt-2 text-sm text-[#8896B3]">
                      Persist employer-worker schedules, enqueue the first run, and re-use the direct payout flow for execution.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Implementation notes</p>
            <div className="mt-4 space-y-3 text-sm text-[#8896B3]">
              <p>Frontend now resolves a username to a payout wallet before payment.</p>
              <p>The backend payment builder now accepts a real recipient wallet instead of the hardcoded mock.</p>
              <p>Recurring payroll creation and persistence still need the dedicated `/payroll` API routes from the project doc.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
