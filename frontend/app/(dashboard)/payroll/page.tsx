'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { BadgeCheck, Loader2, Mail, Plus, Trash2, Users, X, Zap, CircleAlert } from 'lucide-react';
import { createPayroll, deactivatePayroll, fetchPayrolls, fetchUserProfile, type Payroll, type UserProfile } from '@/lib/api';
import { IconAvatar } from '@/components/IconPicker';
import { shortenAddress } from '@/lib/format';
import { PaymentForm } from '@/components/PaymentForm';
import { getOnboardedUser } from '@/lib/onboarding-storage';
import { CopyValueButton } from '@/components/CopyValueButton';

// ── Types ─────────────────────────────────────────────────────────────────────
type InputMode = 'username' | 'wallet';
type LookupState = 'idle' | 'searching' | 'found' | 'not-found' | 'error';

interface MemberRow {
  rowId: string;
  mode: InputMode;
  usernameInput: string;
  walletInput: string;
  labelInput: string;
  lookupState: LookupState;
  resolvedProfile: UserProfile | null;
  amount: string;
  memo: string;
}

function newRow(): MemberRow {
  return {
    rowId: crypto.randomUUID(),
    mode: 'username',
    usernameInput: '',
    walletInput: '',
    labelInput: '',
    lookupState: 'idle',
    resolvedProfile: null,
    amount: '',
    memo: '',
  };
}

// ── Email modal ───────────────────────────────────────────────────────────────
function EmailModal({ onConfirm, onCancel }: { onConfirm: (e: string | null) => void; onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00C896]/15 text-[#00C896]"><Mail size={18} /></div>
          <button onClick={onCancel} className="text-[#8896B3] hover:text-white"><X size={18} /></button>
        </div>
        <h3 className="text-lg font-bold text-white">Notify before payroll runs?</h3>
        <p className="mt-2 text-sm text-[#8896B3]">We'll send a reminder <strong className="text-white">3 days before</strong> each execution so you can top up the vault.</p>
        <input ref={ref} type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="mt-5 w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3 text-sm text-white placeholder:text-[#53627F] focus:border-[#00C896] focus:outline-none" />
        <div className="mt-5 flex gap-3">
          <button onClick={() => onConfirm(email.trim() || null)}
            className="flex-1 rounded-xl bg-[#00C896] py-3 text-sm font-bold text-[#0A0F1E] hover:bg-[#00B085]">
            {email.trim() ? 'Save & Create' : 'Skip & Create'}
          </button>
          <button onClick={onCancel} className="rounded-xl border border-[#1A2235] px-5 py-3 text-sm text-[#8896B3] hover:text-white">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Member row component ──────────────────────────────────────────────────────
function MemberRowCard({ row, onChange, onRemove, canRemove }: {
  row: MemberRow;
  onChange: (patch: Partial<MemberRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const currentUser = getOnboardedUser();

  // Debounced username lookup
  useEffect(() => {
    if (row.mode !== 'username') return;
    const q = row.usernameInput.trim().toLowerCase().replace(/^@/, '');
    if (q.length < 3) { onChange({ lookupState: 'idle', resolvedProfile: null }); return; }
    onChange({ lookupState: 'searching' });
    const t = window.setTimeout(() => {
      void fetchUserProfile(q)
        .then(p => { if (!p) { onChange({ lookupState: 'not-found', resolvedProfile: null }); return; } onChange({ lookupState: 'found', resolvedProfile: p }); })
        .catch(() => onChange({ lookupState: 'error', resolvedProfile: null }));
    }, 400);
    return () => window.clearTimeout(t);
  }, [row.usernameInput, row.mode, onChange]);

  const isSelf = (row.mode === 'username' && row.usernameInput === currentUser?.username) || 
                 (row.mode === 'wallet' && row.walletInput === currentUser?.wallet_address);

  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-4 transition-colors ${
      isSelf ? 'border-[#FF5F82]/30 bg-[#FF5F82]/5' : 'border-[#1A2235] bg-[#0A0F1E]'
    }`}>
      {/* Mode toggle + remove */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-xl border border-[#1A2235] overflow-hidden text-xs">
          {(['username', 'wallet'] as InputMode[]).map(m => (
            <button key={m} type="button" onClick={() => onChange({ mode: m, lookupState: 'idle', resolvedProfile: null })}
              className={`px-3 py-1.5 capitalize transition-colors ${row.mode === m ? 'bg-[#00C896] text-[#0A0F1E] font-bold' : 'text-[#8896B3] hover:text-white'}`}>
              {m === 'username' ? '@username' : 'Wallet'}
            </button>
          ))}
        </div>
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="rounded-lg p-1.5 text-[#4E638A] hover:bg-[#FF5F82]/10 hover:text-[#FF5F82] transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {isSelf && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#FF5F82]">
          You cannot add yourself to a payroll
        </p>
      )}

      {/* Identity input */}
      {row.mode === 'username' ? (
        <div>
          <div className={`flex items-center rounded-xl border bg-[#081122] px-3 ${isSelf ? 'border-[#FF5F82]/50' : 'border-[#1A2235]'}`}>
            <span className="mr-1 text-[#00C896]">@</span>
            <input type="text" value={row.usernameInput}
              onChange={e => onChange({ usernameInput: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
              placeholder="paylink_username"
              className="h-11 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#53627F]" />
            {row.lookupState === 'searching' && <Loader2 size={14} className="animate-spin text-[#8896B3]" />}
            {row.lookupState === 'found' && <BadgeCheck size={14} className="text-[#00C896]" />}
          </div>
          {row.lookupState === 'not-found' && <p className="mt-1 text-xs text-[#FF5F82]">No PayLink user found.</p>}
          {row.resolvedProfile && (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#00C896]/20 bg-[#00C896]/5 px-3 py-2">
              <IconAvatar iconKey={row.resolvedProfile.icon_key ?? 'zap'} size={13} className="h-7 w-7 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{row.resolvedProfile.display_name}</p>
                <p className="text-xs text-[#8896B3]">{shortenAddress(row.resolvedProfile.wallet_address, 4, 4)}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input type="text" value={row.walletInput} onChange={e => onChange({ walletInput: e.target.value.trim() })}
            placeholder="Solana wallet address"
            className={`rounded-xl border bg-[#081122] px-3 py-2.5 text-sm font-mono text-white placeholder:text-[#53627F] focus:outline-none ${isSelf ? 'border-[#FF5F82]/50' : 'border-[#1A2235] focus:border-[#00C896]'}`} />
          <input type="text" value={row.labelInput} onChange={e => onChange({ labelInput: e.target.value })}
            placeholder="Display label (optional)"
            className="rounded-xl border border-[#1A2235] bg-[#081122] px-3 py-2.5 text-sm text-white placeholder:text-[#53627F] focus:border-[#00C896] focus:outline-none" />
        </div>
      )}

      {/* Amount + memo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[#8896B3] text-sm">$</span>
          <input type="number" min="0.01" value={row.amount} onChange={e => onChange({ amount: e.target.value })}
            placeholder="0.00"
            className="w-full rounded-xl border border-[#1A2235] bg-[#081122] pl-7 pr-3 py-2.5 text-sm text-white focus:border-[#00C896] focus:outline-none" />
        </div>
        <input type="text" value={row.memo} onChange={e => onChange({ memo: e.target.value })}
          placeholder="Memo (optional)"
          className="rounded-xl border border-[#1A2235] bg-[#081122] px-3 py-2.5 text-sm text-white placeholder:text-[#53627F] focus:border-[#00C896] focus:outline-none" />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PayrollPage() {
  const { publicKey } = useWallet();
  const employerWallet = publicKey?.toBase58() ?? '';
  const currentUser = getOnboardedUser();

  const [activeTab, setActiveTab] = useState<'single' | 'group'>('single');

  // Single payout state
  const [singleUsername, setSingleUsername] = useState('');
  const [singleRecipient, setSingleRecipient] = useState<UserProfile | null>(null);
  const [singleLookupState, setSingleLookupState] = useState<LookupState>('idle');

  // Group payroll state
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([newRow()]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [isLoadingPayrolls, setIsLoadingPayrolls] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Debounced single lookup
  useEffect(() => {
    const q = singleUsername.trim().toLowerCase().replace(/^@/, '');
    if (q.length < 3) { setSingleRecipient(null); setSingleLookupState('idle'); return; }
    setSingleLookupState('searching');
    const t = window.setTimeout(() => {
      void fetchUserProfile(q).then(p => {
        if (!p) { setSingleRecipient(null); setSingleLookupState('not-found'); return; }
        setSingleRecipient(p); setSingleLookupState('found');
      }).catch(() => { setSingleRecipient(null); setSingleLookupState('error'); });
    }, 400);
    return () => window.clearTimeout(t);
  }, [singleUsername]);

  const loadPayrolls = useCallback(async () => {
    if (!employerWallet) return;
    setIsLoadingPayrolls(true);
    try { setPayrolls(await fetchPayrolls(employerWallet)); }
    catch { /* silent */ }
    finally { setIsLoadingPayrolls(false); }
  }, [employerWallet]);

  useEffect(() => { void loadPayrolls(); }, [loadPayrolls]);

  const patchMember = useCallback((rowId: string, patch: Partial<MemberRow>) => {
    setMembers(prev => prev.map(r => r.rowId === rowId ? { ...r, ...patch } : r));
  }, []);

  const removeMember = useCallback((rowId: string) => {
    setMembers(prev => prev.filter(r => r.rowId !== rowId));
  }, []);

  function validateAndShowModal() {
    setCreateError('');
    if (!employerWallet) { setCreateError('Connect your wallet first.'); return; }
    if (!title.trim()) { setCreateError('Give this payroll a title.'); return; }
    
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const idx = i + 1;
      
      const isSelf = (m.mode === 'username' && m.usernameInput === currentUser?.username) || 
                     (m.mode === 'wallet' && m.walletInput === currentUser?.wallet_address);
      
      if (isSelf) {
        setCreateError(`Member ${idx}: You cannot add yourself to a payroll.`);
        return;
      }

      if (m.mode === 'username' && m.lookupState !== 'found') { setCreateError(`Member ${idx}: resolve a valid username first.`); return; }
      if (m.mode === 'wallet' && !m.walletInput) { setCreateError(`Member ${idx}: enter a wallet address.`); return; }
      if (!m.amount || Number(m.amount) <= 0) { setCreateError(`Member ${idx}: enter a valid USDC amount.`); return; }
    }
    setShowEmailModal(true);
  }

  async function handleEmailConfirm(email: string | null) {
    setShowEmailModal(false);
    setIsCreating(true);
    try {
      const payroll = await createPayroll({
        employer_wallet: employerWallet,
        title: title.trim(),
        notification_email: email || undefined,
        members: members.map(m => ({
          username: m.mode === 'username' ? m.resolvedProfile?.username : undefined,
          wallet_address: m.mode === 'wallet' ? m.walletInput : undefined,
          label: m.mode === 'wallet' ? (m.labelInput || undefined) : undefined,
          amount_usdc: Number(m.amount),
          memo: m.memo || undefined,
        })),
      });
      setPayrolls(prev => [payroll, ...prev]);
      setTitle('');
      setMembers([newRow()]);
      setActiveTab('group');
    } catch (err: any) {
      setCreateError(err?.response?.data?.message || 'Failed to create payroll.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!employerWallet) return;
    setRemovingId(id);
    try { await deactivatePayroll(id, employerWallet); setPayrolls(p => p.filter(r => r.id !== id)); }
    catch { /* silent */ }
    finally { setRemovingId(null); }
  }

  const totalUsdc = members.reduce((s, m) => s + (Number(m.amount) || 0), 0);

  return (
    <>
      {showEmailModal && <EmailModal onConfirm={handleEmailConfirm} onCancel={() => setShowEmailModal(false)} />}

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">Payroll</h1>
            <p className="mt-2 text-sm text-[#8896B3]">
              Send one-time payouts or manage recurring multi-employee payrolls.
            </p>
          </div>
          
          <div className="flex w-fit p-1 bg-[#0D1B35] rounded-2xl border border-[#1A2235]">
            <button
              onClick={() => setActiveTab('single')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                activeTab === 'single' ? 'bg-[#00C896] text-[#0A0F1E] shadow-lg' : 'text-[#8896B3] hover:text-white'
              }`}
            >
              One-time Payout
            </button>
            <button
              onClick={() => setActiveTab('group')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                activeTab === 'group' ? 'bg-[#00C896] text-[#0A0F1E] shadow-lg' : 'text-[#8896B3] hover:text-white'
              }`}
            >
              Group Payroll
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">

          <section className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 h-fit">
            {activeTab === 'single' ? (
              <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">One-time payout</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Send to a single user</h2>
                <p className="mt-2 text-sm text-[#8896B3]">
                  Search by PayLink username to resolve a wallet, then sign a direct USDC transfer.
                </p>

                <div className="mt-6 flex flex-col gap-5">
                  <div className="rounded-2xl border border-white/10 bg-[#0A0F1E] p-4 sm:p-5">
                    <label className="text-sm font-medium text-white">Recipient username</label>
                    <div className="mt-3 flex items-center rounded-2xl border border-[#1A2235] bg-[#081122] px-4">
                      <span className="mr-2 text-lg text-[#00C896]">@</span>
                      <input
                        type="text"
                        value={singleUsername}
                        onChange={(e) => setSingleUsername(e.target.value)}
                        placeholder="username"
                        className="h-14 w-full bg-transparent text-white outline-none placeholder:text-[#53627F]"
                      />
                      {singleLookupState === 'searching' && <Loader2 size={16} className="animate-spin text-[#8896B3]" />}
                      {singleLookupState === 'found' && <BadgeCheck size={16} className="text-[#00C896]" />}
                    </div>
                  </div>

                  {singleRecipient && singleLookupState === 'found' && (
                    <div className="rounded-2xl border border-[#1A2235] bg-[#0A1325] p-5 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                          <IconAvatar iconKey={singleRecipient.icon_key ?? 'zap'} size={18} className="h-14 w-14" />
                          <div>
                            <p className="text-lg font-semibold text-white">{singleRecipient.display_name}</p>
                            <p className="text-sm text-[#8896B3]">@{singleRecipient.username}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0D1B35] px-3 py-2 text-sm text-[#D6DEEE]">
                          <span className="font-mono">{shortenAddress(singleRecipient.wallet_address, 4, 4)}</span>
                          <CopyValueButton value={singleRecipient.wallet_address} title="Copy wallet" className="h-7 w-7 border-transparent bg-transparent" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-2">
                    <PaymentForm
                      recipientUsername={singleRecipient?.username ?? ''}
                      recipientWallet={singleRecipient?.wallet_address ?? ''}
                      fixedAmount={null}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">New payroll</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Create group payroll</h2>
                <p className="mt-2 text-sm text-[#8896B3]">
                  Build a list of employees. After creation, you can schedule and fund the vault.
                </p>

                <div className="mt-6 flex flex-col gap-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-white">Payroll title</label>
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Engineering Team - May"
                      className="w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3 text-white placeholder:text-[#53627F] focus:border-[#00C896] focus:outline-none transition-colors" />
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <label className="text-sm font-medium text-white">
                        Employees
                        <span className="ml-2 rounded-full bg-[#1A2235] px-2 py-0.5 text-xs text-[#8896B3]">{members.length}</span>
                      </label>
                      {totalUsdc > 0 && (
                        <span className="text-xs font-semibold text-[#00C896]">
                          Total: ${totalUsdc.toFixed(2)} USDC
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-3">
                      {members.map((row) => (
                        <MemberRowCard
                          key={row.rowId}
                          row={row}
                          onChange={patch => patchMember(row.rowId, patch)}
                          onRemove={() => removeMember(row.rowId)}
                          canRemove={members.length > 1}
                        />
                      ))}
                    </div>

                    <button type="button" onClick={() => setMembers(p => [...p, newRow()])}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#2C3B5E] py-3 text-sm text-[#8896B3] transition-colors hover:border-[#00C896]/50 hover:text-[#00C896]">
                      <Plus size={15} /> Add employee
                    </button>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-dashed border-[#2C3B5E] bg-[#081122] p-4">
                    <Zap size={15} className="mt-0.5 shrink-0 text-[#FFD166]" />
                    <p className="text-xs text-[#8896B3] leading-relaxed">
                      <strong className="text-white">Vault model:</strong> Group payrolls use a program-controlled vault. You fund it once, and our scheduler handles the recurring distributions.
                    </p>
                  </div>

                  {createError && (
                    <div className="rounded-2xl border border-[#6A1B2D] bg-[#2B1120] px-4 py-3 text-sm text-[#FFB4C2]">
                      {createError}
                    </div>
                  )}

                  <button type="button" onClick={validateAndShowModal} disabled={isCreating}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-[#00C896] py-4 text-base font-bold text-[#0A0F1E] hover:bg-[#00B085] disabled:cursor-not-allowed disabled:opacity-40 transition-colors">
                    {isCreating ? <><Loader2 size={18} className="animate-spin" /> Creating…</> : <><Plus size={18} /> Create payroll</>}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Active payrolls</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">Your payrolls</h2>
                </div>
                <span className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-[#1A2235] px-2 text-xs font-bold text-white">
                  {payrolls.length}
                </span>
              </div>

              {isLoadingPayrolls ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#8896B3]">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              ) : payrolls.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1A2235]">
                    <Users size={20} className="text-[#4E638A]" />
                  </div>
                  <p className="text-sm text-[#8896B3]">No payrolls yet.</p>
                  <p className="text-xs text-[#4E638A]">Create one on the left to get started.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {payrolls.map(p => (
                    <div key={p.id} className="rounded-2xl border border-[#1A2235] bg-[#0A0F1E] p-4 animate-in fade-in duration-200">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-white truncate">{p.title}</p>
                        <button onClick={() => handleDeactivate(p.id)} disabled={removingId === p.id}
                          className="shrink-0 rounded-lg p-1.5 text-[#4E638A] hover:bg-[#FF5F82]/10 hover:text-[#FF5F82] disabled:opacity-40 transition-colors"
                          title="Remove payroll">
                          {removingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-white">${p.total_usdc.toFixed(2)} USDC</span>
                        <span className="rounded-full border border-[#1A2235] px-2 py-0.5 text-xs text-[#8896B3]">
                          {p.member_count} {p.member_count === 1 ? 'member' : 'members'}
                        </span>
                        {p.frequency ? (
                          <span className="rounded-full border border-[#00C896]/30 bg-[#00C896]/10 px-2 py-0.5 text-xs text-[#00C896]">
                            {p.frequency}
                          </span>
                        ) : (
                          <span className="rounded-full border border-[#FFD166]/30 bg-[#FFD166]/10 px-2 py-0.5 text-xs text-[#FFD166]">
                            Unscheduled
                          </span>
                        )}
                      </div>

                      {p.members.slice(0, 3).map(m => (
                        <div key={m.id} className="mt-2 flex items-center gap-2">
                          <IconAvatar iconKey={m.icon_key ?? 'zap'} size={10} className="h-5 w-5 shrink-0" />
                          <span className="text-xs text-[#8896B3] truncate">
                            {m.display_name ?? m.label ?? shortenAddress(m.wallet_address, 4, 4)}
                          </span>
                          <span className="ml-auto text-xs font-medium text-white shrink-0">${m.amount_usdc}</span>
                        </div>
                      ))}
                      {p.member_count > 3 && (
                        <p className="mt-1 text-xs text-[#4E638A]">+{p.member_count - 3} more</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-5">
              <div className="flex items-start gap-3">
                <CircleAlert size={15} className="mt-0.5 shrink-0 text-[#FFD166]" />
                <p className="text-xs text-[#8896B3] leading-relaxed">
                  <strong className="text-white">Next step:</strong> After creating a group payroll, you'll be able to set its schedule and fund the vault.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
