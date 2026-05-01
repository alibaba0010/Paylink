'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { SendTransactionError, Transaction } from '@solana/web3.js';
import {
  BadgeCheck, ChevronDown, ChevronUp, Loader2, Calendar, History, ArrowRightLeft, Clock,
  Zap, AlertTriangle, CheckCircle2, X, Lock, ArrowLeft, Download
} from 'lucide-react';
import {
  cancelPayroll, initiateMultiPayment, confirmBulkPayment, fetchPaymentHistory,
  fetchPayrolls, schedulePayroll, fetchUserProfile, downloadPaymentHistoryCsv,
  initiatePayrollFunding, confirmPayrollFunding, fetchOutgoingScheduledPayments,
  rejectScheduledPayment, fetchClaimablePayments,
  claimPayment, requestGaslessClaim,
  type Payroll, type UserProfile, type PaymentHistoryItem, type ScheduledPaymentClaim,
} from '@/lib/api';
import { IconAvatar } from '@/components/IconPicker';
import { shortenAddress } from '@/lib/format';
import { useSolanaBalance } from '@/hooks/useSolanaBalance';

type Tab = 'single' | 'payroll';

interface Recipient {
  key: string;
  username: string;
  amount: string;
  memo: string;
  profile: UserProfile | null;
  mode: 'username' | 'wallet';
  walletInput: string;
  lookupState: 'idle' | 'searching' | 'found' | 'not-found' | 'error';
}

function newRecipient(): Recipient {
  return { key: crypto.randomUUID(), username: '', amount: '', memo: '', profile: null, lookupState: 'idle', mode: 'username', walletInput: '' };
}

export default function PaymentsPage() {
  const { publicKey, sendTransaction, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const wallet = publicKey?.toBase58() ?? '';
  const { data: balance } = useSolanaBalance();
  const [activeTab, setActiveTab] = useState<Tab>('single');

  // ── Direct tab ──
  const [recipients, setRecipients] = useState<Recipient[]>([newRecipient()]);
  const recipient = recipients[0];
  const [directStatus, setDirectStatus] = useState<'idle'|'building'|'signing'|'done'|'error'>('idle');
  const [directResults, setDirectResults] = useState<{wallet:string;label?:string;sig:string}[]>([]);

  // ── Payroll tab ──
  const [schedules, setSchedules] = useState<Payroll[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [frequency, setFrequency] = useState<'weekly'|'biweekly'|'monthly'>('monthly');
  const [isScheduling, setIsScheduling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isBulkPaying, setIsBulkPaying] = useState(false);
  const [showPayrollMembers, setShowPayrollMembers] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string|null>(null);
  const [errorMsg, setErrorMsg] = useState<string|null>(null);
  const [claimingClaimId, setClaimingClaimId] = useState<string | null>(null);
  const [outgoingClaims, setOutgoingClaims] = useState<ScheduledPaymentClaim[]>([]);
  const [incomingClaims, setIncomingClaims] = useState<ScheduledPaymentClaim[]>([]);
  const [isLoadingIncoming, setIsLoadingIncoming] = useState(false);
  const [rejectingClaimId, setRejectingClaimId] = useState<string | null>(null);

  const selectedPayroll = schedules.find(p => p.id === selectedId) ?? null;
  const selectedOutgoingClaims = outgoingClaims.filter(claim => claim.payroll_id === selectedId);

  // Aggregate global stats for the Payroll tab
  const activeSchedules = schedules.filter(p => p.frequency);

  // Lookup effect for each recipient
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    recipients.forEach((r, i) => {
      const q = r.username.trim().toLowerCase().replace(/^@/, '');
      if (q.length < 3) {
        if (r.lookupState !== 'idle') updateRecipient(i, { profile: null, lookupState: 'idle' });
        return;
      }
      if (r.lookupState === 'idle' || r.lookupState === 'not-found' || r.lookupState === 'error') {
        updateRecipient(i, { lookupState: 'searching' });
      }
      const t = setTimeout(() => {
        fetchUserProfile(q)
          .then(p => updateRecipient(i, p ? { profile: p, lookupState: 'found' } : { profile: null, lookupState: 'not-found' }))
          .catch(() => updateRecipient(i, { profile: null, lookupState: 'error' }));
      }, 400);
      timers.push(t);
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients.map(r => r.username).join(',')]);

  function updateRecipient(i: number, patch: Partial<Recipient>) {
    setRecipients(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  const submitWalletTransaction = useCallback(async (tx: Transaction) => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }

    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = publicKey;
    tx.recentBlockhash = latest.blockhash;

    try {
      if (signTransaction) {
        const signedTx = await signTransaction(tx);
        const derivedSigBytes =
          signedTx.signature ??
          signedTx.signatures.find(({ publicKey: signer }) => signer.equals(publicKey))?.signature ??
          signedTx.signatures[0]?.signature ??
          null;

        const derivedSig = derivedSigBytes ? bs58.encode(derivedSigBytes) : null;

        let sig = derivedSig;

        try {
          sig = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3,
          });
        } catch (err: any) {
          const alreadyProcessed = String(err?.message || '').includes('already been processed');
          if (!alreadyProcessed || !derivedSig) {
            throw err;
          }
          sig = derivedSig;
        }

        if (!sig) {
          throw new Error('Signed transaction signature could not be derived');
        }

        await connection.confirmTransaction({
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        }, 'confirmed');

        return sig;
      }

      const sig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      await connection.confirmTransaction({
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }, 'confirmed');

      return sig;
    } catch (err: any) {
      const logs = err instanceof SendTransactionError
        ? await err.getLogs(connection).catch(() => [])
        : [];
      const message =
        err?.cause?.message ||
        err?.message ||
        'Wallet failed to sign and send the transaction';

      console.error('[wallet] transaction submission failed', {
        name: err?.name,
        message,
        cause: err?.cause,
        logs,
      });

      throw new Error(message);
    }
  }, [connection, publicKey, sendTransaction, signTransaction]);

  const loadSchedules = useCallback(async () => {
    if (!wallet) return;
    setIsLoadingSchedules(true);
    setIsLoadingIncoming(true);
    setErrorMsg(null);
    try { 
      const [data, outgoing, incoming] = await Promise.all([
        fetchPayrolls(wallet),
        fetchOutgoingScheduledPayments(wallet),
        fetchClaimablePayments(wallet),
      ]);
      setSchedules(data); 
      setOutgoingClaims(outgoing);
      setIncomingClaims(incoming);
    } catch (err: any) { 
      setErrorMsg(err?.response?.data?.message || 'Failed to load payroll groups');
    }
    finally {
      setIsLoadingSchedules(false);
      setIsLoadingIncoming(false);
    }
  }, [wallet]);

  useEffect(() => { if (activeTab === 'payroll') void loadSchedules(); }, [activeTab, loadSchedules]);
  useEffect(() => { setShowPayrollMembers(false); }, [selectedId]);

  // ── Direct payment send ──
  async function handleDirectPay() {
    if (!connected || !publicKey) return;
    const valid = recipients.filter(r => 
      ((r.mode === 'username' && r.profile) || (r.mode === 'wallet' && r.walletInput.trim())) 
      && r.amount && Number(r.amount) > 0
    );
    if (valid.length === 0) return;

    setDirectStatus('building');
    setDirectResults([]);
    try {
      const { transactions, recipients: returnedRecipients } = await initiateMultiPayment({
        sender_pubkey: wallet,
        recipients: valid.map(r => ({
          wallet_address: r.mode === 'username' ? r.profile!.wallet_address : r.walletInput.trim(),
          amount_usdc: Number(r.amount),
          label: r.mode === 'username' ? r.profile!.username : shortenAddress(r.walletInput.trim(), 4, 4),
          memo: r.memo || undefined,
        })),
      });

      setDirectStatus('signing');
      const sigs: string[] = [];
      for (const tBase64 of transactions) {
        const tx = Transaction.from(Buffer.from(tBase64, 'base64'));
        const sig = await submitWalletTransaction(tx);
        sigs.push(sig);
      }

      const signed: { wallet: string; label?: string; sig: string; amount: number }[] = [];
      const CHUNK_SIZE = 10;
      for (let i = 0; i < returnedRecipients.length; i++) {
        const r = returnedRecipients[i];
        const chunkIndex = Math.floor(i / CHUNK_SIZE);
        signed.push({ wallet: r.wallet_address, label: r.label, sig: sigs[chunkIndex], amount: r.amount_usdc });
      }

      await confirmBulkPayment({
        sender_wallet: wallet,
        recipients: signed.map(s => ({ wallet_address: s.wallet, amount_usdc: s.amount, signature: s.sig, label: s.label })),
      });

      setDirectResults(signed.map(s => ({ wallet: s.wallet, label: s.label, sig: s.sig })));
      setDirectStatus('done');
    } catch (e) {
      console.error(e);
      setDirectStatus('error');
    }
  }

  // ── Activate schedule ──
  async function handleActivateSchedule() {
    if (!selectedId || !wallet) return;
    setIsScheduling(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const { cycle } = await schedulePayroll(selectedId, wallet, frequency);
      setSuccessMsg(`Schedule activated! Next payout cycle begins on ${new Date(cycle.due_at).toLocaleDateString()}.`);
      await loadSchedules();
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err?.message || 'Failed to schedule payroll');
    } finally { setIsScheduling(false); }
  }

  // ── Fund Payroll Escrow ──
  async function handleFundEscrow() {
    if (!selectedPayroll || !wallet || !publicKey || !connected || !selectedPayroll.members.length) return;
    setIsBulkPaying(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const { transactions, next_run_at } = await initiatePayrollFunding(selectedPayroll.id, wallet);

      const sigs: string[] = [];
      for (const tBase64 of transactions) {
        const tx = Transaction.from(Buffer.from(tBase64, 'base64'));
        const sig = await submitWalletTransaction(tx);
        sigs.push(sig);
      }

      const fundedPayroll = await confirmPayrollFunding(selectedPayroll.id, wallet, sigs);
      setSchedules(prev => prev.map(p => p.id === fundedPayroll.id ? fundedPayroll : p));
      setSuccessMsg(
        `Escrow funded for ${selectedPayroll.members.length} members. Next payout cycle opens ${new Date(next_run_at).toLocaleDateString()}.`
      );
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err?.message || 'Escrow funding failed');
    } finally { 
      setIsBulkPaying(false); 
    }
  }

  // ── Cancel payroll ──
  async function handleCancel() {
    if (!selectedId || !wallet) return;
    if (!confirm('Cancel this payroll? Funds will be returned to your wallet.')) return;
    setIsCancelling(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await cancelPayroll(selectedId, wallet);
      setSuccessMsg('Payroll cancelled. Funds will be returned to your wallet.');
      setSelectedId(null);
      await loadSchedules();
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err?.message || 'Failed to cancel');
    } finally { setIsCancelling(false); }
  }

  async function handleRejectClaim(claimId: string) {
    if (!wallet) return;
    setRejectingClaimId(claimId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await rejectScheduledPayment(claimId, wallet);
      setOutgoingClaims(prev => prev.map(claim => claim.id === claimId ? { ...claim, status: 'cancelled' } : claim));
      setSuccessMsg('Scheduled payment rejected.');
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err?.message || 'Failed to reject payment');
    } finally {
      setRejectingClaimId(null);
    }
  }

  async function handleClaimPayment(claimId: string) {
    if (!wallet) return;
    setClaimingClaimId(claimId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const isGasless = !balance || balance.sol < 0.005;
      
      let sig = "";
      if (isGasless) {
        const txBase64 = await requestGaslessClaim(claimId, wallet);
        const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
        sig = await submitWalletTransaction(tx);
        await claimPayment(claimId, wallet, sig);
        setSuccessMsg('Gasless claim successful! ⚡ Fee sponsored by PayLink.');
      } else {
        // Fallback to regular gasless claim for now
        const txBase64 = await requestGaslessClaim(claimId, wallet);
        const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
        sig = await submitWalletTransaction(tx);
        await claimPayment(claimId, wallet, sig);
        setSuccessMsg('Claim successful!');
      }

      setIncomingClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'claimed' } : c));
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err?.message || 'Failed to claim payment');
    } finally {
      setClaimingClaimId(null);
    }
  }

  const canPay = connected && 
                 ((recipient.mode === 'username' && recipient.profile !== null) || 
                  (recipient.mode === 'wallet' && recipient.walletInput.trim().length > 0)) && 
                 Number(recipient.amount) > 0;
  const totalDirect = Number(recipient.amount) || 0;

  const cycleLockDate = selectedPayroll?.next_run_at ? new Date(selectedPayroll.next_run_at) : null;
  const isCycleFunded = !!(
    selectedPayroll &&
    selectedPayroll.escrow_funded &&
    cycleLockDate &&
    cycleLockDate > new Date()
  );
  const payrollStatusLabel = !selectedPayroll?.frequency
    ? 'Not scheduled'
    : isCycleFunded
      ? 'Funded'
      : 'Waiting for payment approval';
  const payrollStatusTone = isCycleFunded
    ? 'text-[#00C896]'
    : 'text-amber-400';

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">Payments</h1>
        <p className="mt-2 text-sm text-[#8896B3]">Send direct funds or manage scheduled payment cycles.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-[#0D1B35] rounded-2xl border border-[#1A2235] w-fit">
        {(['single', 'payroll'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2.5 ${
              activeTab === tab
                ? 'bg-[#00C896] text-[#0A0F1E] shadow-lg shadow-[#00C896]/20'
                : 'text-[#8896B3] hover:text-white hover:bg-white/5'
            }`}
          >
            {tab === 'single' && <ArrowRightLeft size={16} />}
            {tab === 'payroll' && <Calendar size={16} />}
            <span className="capitalize">{tab}</span>
          </button>
        ))}
      </div>

      {/* ── Direct Tab ─────────────────────────────────────── */}
      {activeTab === 'single' && (
        <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <section className="rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-8 shadow-xl shadow-black/20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white tracking-tight">Direct Payment</h2>
              <p className="text-sm text-[#8896B3] mt-1">Send instantly to a PayLink user or wallet.</p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Single recipient */}
              <div className="rounded-2xl border border-[#1A2235] bg-[#0A0F1E] p-5 flex flex-col gap-3">
                
                <div className="flex rounded-xl border border-[#1A2235] bg-[#081122] overflow-hidden p-1 shadow-inner w-fit mb-2">
                  {(['username', 'wallet'] as const).map(m => (
                    <button key={m} type="button" onClick={() => updateRecipient(0, { mode: m })}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all ${recipient.mode === m ? 'bg-[#00C896] text-[#0A0F1E] shadow-md' : 'text-[#4E638A] hover:text-white'}`}>
                      {m === 'username' ? '@User' : 'Wallet'}
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  {/* Target input */}
                  {recipient.mode === 'username' ? (
                    <div className="flex-1 relative flex items-center rounded-xl border border-[#1A2235] bg-[#081122] px-3">
                      <span className="text-[#00C896] mr-2">@</span>
                      <input
                        type="text"
                        value={recipient.username}
                        onChange={e => updateRecipient(0, { username: e.target.value, profile: null, lookupState: 'idle' })}
                        placeholder="username"
                        className="h-11 w-full bg-transparent text-white outline-none placeholder:text-[#53627F] text-sm"
                      />
                      {recipient.lookupState === 'searching' && <Loader2 size={14} className="animate-spin text-[#8896B3]" />}
                      {recipient.lookupState === 'found' && <BadgeCheck size={14} className="text-[#00C896]" />}
                    </div>
                  ) : (
                    <div className="flex-1 relative flex items-center rounded-xl border border-[#1A2235] bg-[#081122] px-3">
                      <input
                        type="text"
                        value={recipient.walletInput}
                        onChange={e => updateRecipient(0, { walletInput: e.target.value })}
                        placeholder="Solana wallet address"
                        className="h-11 w-full bg-transparent text-white outline-none placeholder:text-[#53627F] text-sm font-mono"
                      />
                    </div>
                  )}
                  {/* Amount */}
                  <div className="relative flex items-center rounded-xl border border-[#1A2235] bg-[#081122] px-3 w-36">
                    <span className="text-[#8896B3] mr-1 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      value={recipient.amount}
                      onChange={e => updateRecipient(0, { amount: e.target.value })}
                      placeholder="0.00"
                      className="h-11 w-full bg-transparent text-white outline-none text-sm"
                    />
                  </div>
                </div>

                {recipient.mode === 'username' && recipient.lookupState === 'found' && recipient.profile && (
                  <div className="flex items-center gap-3 rounded-xl border border-[#00C896]/20 bg-[#00C896]/5 px-3 py-2 animate-in zoom-in-95 duration-150">
                    <IconAvatar iconKey={recipient.profile.icon_key ?? 'zap'} size={14} className="h-8 w-8" />
                    <div>
                      <p className="text-sm font-semibold text-white">{recipient.profile.display_name}</p>
                      <p className="text-xs text-[#8896B3]">{shortenAddress(recipient.profile.wallet_address, 4, 4)}</p>
                    </div>
                  </div>
                )}
                {recipient.mode === 'username' && recipient.lookupState === 'not-found' && <p className="text-xs text-[#FF5F82]">User not found.</p>}

                <input
                  type="text"
                  value={recipient.memo}
                  onChange={e => updateRecipient(0, { memo: e.target.value })}
                  placeholder="Memo (optional)"
                  className="w-full bg-[#081122] border border-[#1A2235] rounded-xl px-3 py-2 text-sm text-white focus:border-[#00C896] outline-none"
                />
              </div>

              {directStatus === 'done' && directResults.length > 0 && (
                <div className="rounded-2xl border border-[#00C896]/20 bg-[#00C896]/5 p-4 flex flex-col gap-2 animate-in fade-in">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 size={18} className="text-[#00C896]" />
                    <span className="font-bold text-[#00C896]">Payment sent!</span>
                  </div>
                  {directResults.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-[#8896B3]">
                      <span>{r.label ?? shortenAddress(r.wallet, 4, 4)}</span>
                      <a href={`https://solscan.io/tx/${r.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
                        className="text-[#00C896] hover:underline font-mono">{r.sig.slice(0, 12)}…</a>
                    </div>
                  ))}
                </div>
              )}

              {directStatus === 'error' && (
                <div className="rounded-xl border border-[#FF5F82]/30 bg-[#FF5F82]/5 px-4 py-3 flex items-center gap-2 text-[#FF5F82] text-sm">
                  <AlertTriangle size={16} /> Payment failed. Please try again.
                </div>
              )}

              <button
                id="pay-now-btn"
                onClick={handleDirectPay}
                disabled={!canPay || (directStatus !== 'idle' && directStatus !== 'error' && directStatus !== 'done')}
                className="w-full flex items-center justify-center gap-3 rounded-[20px] bg-[#00C896] py-5 text-lg font-black text-[#0A0F1E] hover:bg-[#00E5AC] active:scale-[0.98] transition-all shadow-xl shadow-[#00C896]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {directStatus === 'building' || directStatus === 'signing' ? (
                  <><Loader2 className="animate-spin" size={22} />
                  <span>{directStatus === 'building' ? 'Preparing…' : 'Confirm in wallet…'}</span></>
                ) : (
                  <><ArrowRightLeft size={22} />
                  <span className="uppercase tracking-widest">
                    {totalDirect > 0 ? `Pay $${totalDirect.toFixed(2)}` : 'Pay'}
                  </span></>
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Payroll / Schedule Tab ─────────────────────────── */}
      {activeTab === 'payroll' && (
        <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <section className="rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-8 shadow-xl shadow-black/20 flex flex-col gap-8">
            <div className="flex items-center gap-3">
              {selectedId ? (
                <button 
                  onClick={() => { setSelectedId(null); setSuccessMsg(null); setErrorMsg(null); }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-[#8896B3] hover:text-white hover:bg-white/10 transition-all active:scale-95"
                  title="Back to overview"
                >
                  <ArrowLeft size={20} />
                </button>
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00C896]/15 text-[#00C896]">
                  <Zap size={20} />
                </div>
              )}
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">
                  {selectedId ? 'Manage Schedule' : 'Schedule Payments'}
                </h2>
                <p className="text-sm text-[#8896B3] mt-0.5">
                  {selectedId ? `Reviewing cycles for ${selectedPayroll?.title || 'group'}` : 'Escrow-backed recurring payouts with 3-day signing window.'}
                </p>
              </div>
            </div>

            {/* Global Messages */}
            {successMsg && (
              <div className="rounded-2xl bg-[#00C896]/10 border border-[#00C896]/20 p-4 flex items-center gap-3 animate-in fade-in">
                <BadgeCheck size={18} className="text-[#00C896] shrink-0" />
                <p className="text-sm font-bold text-[#00C896]">{successMsg}</p>
              </div>
            )}
            {errorMsg && (
              <div className="rounded-2xl bg-[#FF5F82]/10 border border-[#FF5F82]/20 p-4 flex items-center gap-3 animate-in fade-in">
                <AlertTriangle size={18} className="text-[#FF5F82] shrink-0" />
                <p className="text-sm font-bold text-[#FF5F82]">{errorMsg}</p>
              </div>
            )}

            {/* ── Incoming Scheduled Payments (this wallet as recipient) ── */}
            <div className="rounded-2xl border border-[#00C896]/15 bg-[#00C896]/5 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#00C896]/20 text-[#00C896]">
                  <Download size={14} />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#00C896]">
                  Scheduled Incoming Payments
                </p>
              </div>
              {isLoadingIncoming ? (
                <div className="flex items-center gap-2 text-[#8896B3] text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
              ) : incomingClaims.length === 0 ? (
                <p className="text-sm text-[#8896B3]">No scheduled incoming payments yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {incomingClaims.map((claim) => {
                    const title = claim.payroll_schedules?.title || 'Payroll payment';
                    const unlockDate = new Date(claim.claimable_at);
                    const isClaimed = claim.status === 'claimed';
                    const isCancelled = claim.status === 'cancelled';
                    const statusLabel =
                      isClaimed ? 'Claimed' :
                      isCancelled ? 'Rejected' :
                      claim.can_claim ? 'Ready to claim' :
                      `Locked until ${unlockDate.toLocaleDateString()}`;
                    return (
                      <div key={claim.id} className="flex flex-col gap-2 rounded-xl border border-[#1A2235] bg-[#0A0F1E]/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-white text-sm">{title}</p>
                          <p className="mt-0.5 text-xs text-[#8896B3]">
                            ${Number(claim.amount_usdc).toFixed(2)} · {statusLabel}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`self-start rounded-full px-2 py-1 text-[10px] font-bold sm:self-auto ${
                            isClaimed ? 'bg-[#00C896]/20 text-[#00C896]' :
                            isCancelled ? 'bg-[#FF5F82]/20 text-[#FF5F82]' :
                            claim.can_claim ? 'bg-amber-500/20 text-amber-400' :
                            'bg-[#1A2235] text-[#8896B3]'
                          }`}>
                            {isClaimed ? 'Claimed' : isCancelled ? 'Rejected' : claim.can_claim ? 'Available' : 'Locked'}
                          </span>
                          {claim.can_claim && !isClaimed && !isCancelled && (
                            <button
                              onClick={() => handleClaimPayment(claim.id)}
                              disabled={claimingClaimId === claim.id}
                              className="ml-2 bg-[#00C896] hover:bg-[#00B085] text-[#0A0F1E] font-bold text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              {claimingClaimId === claim.id ? <Loader2 size={12} className="animate-spin" /> : 'Claim'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Select payroll group */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-white/70 uppercase tracking-wider">
                {selectedId ? 'Switch Payroll Group' : 'Select Payroll Group'}
              </label>
              {isLoadingSchedules ? (
                <div className="flex items-center gap-2 text-[#8896B3] text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
              ) : (
                <select
                  value={selectedId ?? ''}
                  onChange={e => { setSelectedId(e.target.value || null); setSuccessMsg(null); setErrorMsg(null); }}
                  className="w-full h-14 rounded-2xl border border-[#1A2235] bg-[#081122] px-4 text-white outline-none focus:border-[#00C896] transition-all appearance-none"
                >
                  <option value="">Choose a group…</option>
                  {schedules.map(p => (
                    <option key={p.id} value={p.id}>{p.title} · ${p.total_usdc.toFixed(2)} · {p.member_count} members</option>
                  ))}
                </select>
              )}
            </div>

            {/* Active Schedules Overview (when none selected) */}
            {!selectedId && activeSchedules.length > 0 && (
              <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2">
                <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider">Already Scheduled</h3>
                <div className="grid gap-3">
                  {activeSchedules.map(p => (
                    <div 
                      key={p.id} 
                      onClick={() => setSelectedId(p.id)}
                      className="group rounded-2xl border border-[#1A2235] bg-[#0A0F1E]/60 p-5 flex items-center justify-between hover:border-[#00C896]/40 transition-all cursor-pointer shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-xl bg-[#00C896]/10 flex items-center justify-center text-[#00C896]">
                          <Calendar size={20} />
                        </div>
                        <div>
                          <p className="font-bold text-white group-hover:text-[#00C896] transition-colors">{p.title}</p>
                          <p className="text-xs text-[#8896B3] capitalize">{p.frequency} · ${p.total_usdc.toFixed(2)}/cycle</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-[#4E638A] uppercase tracking-widest mb-1">Next Payout</p>
                        <p className="text-sm font-bold text-white">
                          {p.next_run_at ? new Date(p.next_run_at).toLocaleDateString() : 'Pending'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!selectedId && activeSchedules.length === 0 && !isLoadingSchedules && (
               <div className="rounded-3xl border border-dashed border-[#1A2235] p-12 flex flex-col items-center text-center">
                 <div className="h-12 w-12 rounded-full bg-[#1A2235] flex items-center justify-center mb-4 text-[#4E638A]">
                   <Clock size={24} />
                 </div>
                 <h3 className="text-white font-bold">No active schedules</h3>
                 <p className="text-sm text-[#8896B3] max-w-xs mt-1">Select a group above to activate a recurring payroll schedule.</p>
               </div>
            )}

            {selectedPayroll && (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-top-2 duration-300">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Members', value: selectedPayroll.member_count },
                    { label: 'Total / Cycle', value: `$${selectedPayroll.total_usdc.toFixed(2)}` },
                    { label: 'Status', value: payrollStatusLabel },
                  ].map(s => (
                    <div key={s.label} className="rounded-2xl border border-white/5 bg-[#0A0F1E]/60 p-4 text-center">
                      <p className="text-xs text-[#4E638A] uppercase tracking-wider mb-1">{s.label}</p>
                      <p className={`text-lg font-black ${s.label === 'Status' ? payrollStatusTone : 'text-white'}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Active cycles overview */}
                {(selectedPayroll.cycles?.length ?? 0) > 0 && (
                  <div className="rounded-2xl border border-white/5 bg-[#0A0F1E]/60 p-5">
                    <p className="text-xs font-bold text-[#4E638A] uppercase tracking-wider mb-3">Payment Cycles</p>
                    <div className="flex flex-col gap-2">
                      {selectedPayroll.cycles.map(c => (
                        <div key={c.id} className="flex items-center justify-between text-sm">
                          <span className="text-white">Cycle #{c.cycle_number} — due {new Date(c.due_at).toLocaleDateString()}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            c.status === 'signed' ? 'bg-[#00C896]/20 text-[#00C896]' :
                            c.status === 'cancelled' ? 'bg-[#FF5F82]/20 text-[#FF5F82]' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>{c.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedOutgoingClaims.length > 0 && (
                  <div className="rounded-2xl border border-white/5 bg-[#0A0F1E]/60 p-5">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#4E638A]">Sent Escrow Payments</p>
                    <div className="flex flex-col gap-3">
                      {selectedOutgoingClaims.map((claim) => {
                        const isClaimed = claim.status === 'claimed';
                        const isRejected = claim.status === 'cancelled';
                        return (
                          <div key={claim.id} className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-black/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-bold text-white">${Number(claim.amount_usdc).toFixed(2)} scheduled payment</p>
                              <p className="mt-1 text-xs text-[#8896B3]">
                                Recipient {claim.wallet_address ? shortenAddress(claim.wallet_address, 5, 5) : 'wallet'} · unlocks {new Date(claim.claimable_at).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                                isClaimed ? 'bg-[#00C896]/20 text-[#00C896]' :
                                isRejected ? 'bg-[#FF5F82]/20 text-[#FF5F82]' :
                                claim.can_claim ? 'bg-amber-500/20 text-amber-400' :
                                'bg-[#1A2235] text-[#8896B3]'
                              }`}>
                                {isClaimed ? 'claimed' : isRejected ? 'rejected' : claim.can_claim ? 'available' : 'locked'}
                              </span>
                              {!isClaimed && !isRejected && (
                                <button
                                  type="button"
                                  onClick={() => handleRejectClaim(claim.id)}
                                  disabled={rejectingClaimId === claim.id}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#FF5F82]/40 px-3 text-xs font-bold text-[#FF5F82] hover:bg-[#FF5F82]/10 disabled:opacity-40"
                                >
                                  {rejectingClaimId === claim.id ? <Loader2 className="animate-spin" size={14} /> : <X size={14} />}
                                  Reject
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-white/5 bg-[#0A0F1E]/60 p-5">
                  <button
                    type="button"
                    onClick={() => setShowPayrollMembers(prev => !prev)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div>
                      <p className="text-xs font-bold text-[#4E638A] uppercase tracking-wider">Payroll Members</p>
                      <p className="mt-1 text-sm text-white">
                        {showPayrollMembers ? 'Hide member breakdown' : `Show ${selectedPayroll.member_count} member${selectedPayroll.member_count === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    {showPayrollMembers ? <ChevronUp size={18} className="text-[#8896B3]" /> : <ChevronDown size={18} className="text-[#8896B3]" />}
                  </button>

                  {showPayrollMembers && (
                    <div className="mt-4 flex flex-col gap-3 border-t border-white/5 pt-4">
                      {selectedPayroll.members.map((member) => (
                        <div key={member.id} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-black/10 px-4 py-3">
                          <IconAvatar iconKey={member.icon_key ?? 'zap'} size={12} className="h-9 w-9" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-white">
                              {member.display_name ?? member.label ?? shortenAddress(member.wallet_address, 4, 4)}
                            </p>
                            <p className="truncate text-xs text-[#8896B3]">
                              {member.username ? `@${member.username}` : shortenAddress(member.wallet_address, 6, 6)}
                            </p>
                          </div>
                          <span className="text-sm font-black text-[#00C896]">${member.amount_usdc.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Frequency selector (only if not yet scheduled) */}
                {!selectedPayroll.frequency && (
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-white/70 uppercase tracking-wider">Payment Frequency</label>
                    <div className="grid grid-cols-3 gap-3">
                      {(['weekly', 'biweekly', 'monthly'] as const).map(f => (
                        <button key={f} onClick={() => setFrequency(f)}
                          className={`h-20 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 ${
                            frequency === f
                              ? 'bg-[#00C896] border-[#00C896] text-[#0A0F1E] shadow-xl shadow-[#00C896]/20'
                              : 'border-[#1A2235] bg-[#081122] text-[#8896B3] hover:border-[#2C3B5E]'
                          }`}>
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Every</span>
                          <span className="text-sm font-bold uppercase">{f === 'biweekly' ? '2 Weeks' : f === 'weekly' ? 'Week' : 'Month'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedPayroll.frequency && (
                  <div className="flex items-center gap-2 rounded-xl bg-[#00C896]/5 border border-[#00C896]/10 px-4 py-3 text-sm text-[#00C896]">
                    <Clock size={14} />
                    <span>Frequency: <strong>{selectedPayroll.frequency}</strong> · Next payout: <strong>{selectedPayroll.next_run_at ? new Date(selectedPayroll.next_run_at).toLocaleDateString() : '—'}</strong></span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleFundEscrow}
                    disabled={isBulkPaying || isScheduling || !selectedPayroll.frequency || isCycleFunded}
                    className="flex-1 flex items-center justify-center gap-3 rounded-[20px] bg-[#00C896] py-5 text-sm font-black text-[#0A0F1E] hover:bg-[#00E5AC] active:scale-[0.98] transition-all shadow-xl shadow-[#00C896]/20 disabled:opacity-40"
                  >
                    {isBulkPaying ? <Loader2 className="animate-spin" size={20} /> : <><Zap size={18} /><span className="uppercase tracking-widest">Pay To Escrow</span></>}
                  </button>

                  {selectedPayroll.frequency && isCycleFunded && selectedPayroll.next_run_at && (
                    <p className="text-center text-xs text-[#8896B3]">
                      Escrow is funded for this cycle. Funding unlocks again on {new Date(selectedPayroll.next_run_at).toLocaleDateString()}.
                    </p>
                  )}

                  {!selectedPayroll.frequency && (
                    <button
                      onClick={handleActivateSchedule}
                      disabled={isScheduling || isBulkPaying}
                      className="flex-1 flex items-center justify-center gap-3 rounded-[20px] bg-[#0A0F1E] border border-[#1A2235] py-5 text-sm font-black text-white hover:bg-[#1A2235] active:scale-[0.98] transition-all disabled:opacity-40"
                    >
                      {isScheduling ? <Loader2 className="animate-spin" size={20} /> : <><Lock size={18} /><span className="uppercase tracking-widest">Activate Escrow</span></>}
                    </button>
                  )}
                  <button
                    onClick={handleCancel}
                    disabled={isCancelling}
                    className="flex items-center justify-center gap-2 rounded-[20px] border border-[#FF5F82]/40 bg-[#FF5F82]/5 px-6 py-5 text-base font-bold text-[#FF5F82] hover:bg-[#FF5F82]/15 transition-all disabled:opacity-40 mt-2"
                  >
                    {isCancelling ? <Loader2 className="animate-spin" size={18} /> : <><X size={18} /><span>Cancel & Refund</span></>}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
