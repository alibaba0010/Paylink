'use client';

import { useCallback, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { BadgeCheck, ChevronDown, ChevronUp, Loader2, Mail, Plus, Trash2, Zap, CircleAlert, ArrowRightLeft, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { createPayroll, updatePayroll, fetchUserProfile, fetchPayrolls, deactivatePayroll, initiateMultiPayment, confirmBulkPayment, downloadPayrollCsv, type Payroll, type UserProfile } from '@/lib/api';
import { IconAvatar } from '@/components/IconPicker';
import { shortenAddress } from '@/lib/format';
import { getOnboardedUser } from '@/lib/onboarding-storage';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { Edit2 } from 'lucide-react';

export interface MemberRow {
  rowId: string;
  mode: 'username' | 'wallet';
  usernameInput: string;
  walletInput: string;
  labelInput: string;
  lookupState: 'idle' | 'searching' | 'found' | 'not-found' | 'error';
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00C896]/15 text-[#00C896]"><Mail size={18} /></div>
          <button onClick={onCancel} className="text-[#8896B3] hover:text-white">✕</button>
        </div>
        <h3 className="text-lg font-bold text-white">Notify employees?</h3>
        <p className="mt-2 text-sm text-[#8896B3]">We'll send a reminder <strong className="text-white">3 days before</strong> each execution so you can top up the vault.</p>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="admin@company.com"
          className="mt-5 w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3 text-sm text-white placeholder:text-[#53627F] focus:border-[#00C896] focus:outline-none" />
        <div className="mt-5 flex gap-3">
          <button onClick={() => onConfirm(email.trim() || null)}
            className="flex-1 rounded-xl bg-[#00C896] py-3 text-sm font-bold text-[#0A0F1E] hover:bg-[#00B085]">
            {email.trim() ? 'Confirm & Create' : 'Skip & Create'}
          </button>
          <button onClick={onCancel} className="rounded-xl border border-[#1A2235] px-5 py-3 text-sm text-[#8896B3] hover:text-white">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Member row component ──────────────────────────────────────────────────────
function MemberRowCard({ row, onPatch, onRemove, canRemove }: {
  row: MemberRow;
  onPatch: (rowId: string, patch: Partial<MemberRow>) => void;
  onRemove: (rowId: string) => void;
  canRemove: boolean;
}) {
  const rowId = row.rowId;
  const onChange = useCallback((patch: Partial<MemberRow>) => onPatch(rowId, patch), [onPatch, rowId]);
  const currentUser = getOnboardedUser();

  // Debounced username lookup
  const [isSearching, setIsSearching] = useState(false);
  const handleLookup = useCallback(async (q: string) => {
    if (q.length < 3) { onChange({ lookupState: 'idle', resolvedProfile: null }); return; }
    setIsSearching(true);
    try {
      const p = await fetchUserProfile(q);
      if (!p) { onChange({ lookupState: 'not-found', resolvedProfile: null }); }
      else { onChange({ lookupState: 'found', resolvedProfile: p }); }
    } catch {
      onChange({ lookupState: 'error', resolvedProfile: null });
    } finally {
      setIsSearching(false);
    }
  }, [onChange]);

  const isSelf = (row.mode === 'username' && row.usernameInput === currentUser?.username) || 
                 (row.mode === 'wallet' && row.walletInput === currentUser?.wallet_address);

  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-5 transition-all duration-300 ${
      isSelf ? 'border-[#FF5F82]/40 bg-[#FF5F82]/5 shadow-lg shadow-[#FF5F82]/5' : 'border-[#1A2235] bg-[#0A0F1E]/80 backdrop-blur-sm'
    } hover:border-[#00C896]/30 shadow-inner`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-xl border border-[#1A2235] bg-[#081122] overflow-hidden p-1 shadow-inner">
          {(['username', 'wallet'] as const).map(m => (
            <button key={m} type="button" onClick={() => onChange({ mode: m, lookupState: 'idle', resolvedProfile: null })}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all ${row.mode === m ? 'bg-[#00C896] text-[#0A0F1E] shadow-md' : 'text-[#4E638A] hover:text-white'}`}>
              {m === 'username' ? '@User' : 'Wallet'}
            </button>
          ))}
        </div>
        {canRemove && (
          <button type="button" onClick={() => onRemove(rowId)}
            className="rounded-xl p-2 text-[#4E638A] hover:bg-[#FF5F82]/10 hover:text-[#FF5F82] transition-all active:scale-90">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="space-y-4">
        {row.mode === 'username' ? (
          <div className="space-y-2">
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#00C896] font-bold text-lg group-focus-within:scale-110 transition-transform">@</span>
              <input type="text" value={row.usernameInput}
                onChange={e => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                  onChange({ usernameInput: val });
                  handleLookup(val);
                }}
                placeholder="PayLink username"
                className="h-13 w-full rounded-xl border border-[#1A2235] bg-[#081122] pl-10 pr-10 text-sm text-white outline-none focus:border-[#00C896] transition-all placeholder:text-[#3A4A6E] shadow-inner font-medium" />
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                {isSearching ? <Loader2 size={16} className="animate-spin text-[#8896B3]" /> : 
                 row.lookupState === 'found' ? <BadgeCheck size={18} className="text-[#00C896] drop-shadow-[0_0_8px_rgba(0,200,150,0.5)]" /> : null}
              </div>
            </div>
            {row.resolvedProfile && (
              <div className="flex items-center gap-3 rounded-xl border border-[#00C896]/20 bg-[#00C896]/5 px-4 py-2.5 animate-in zoom-in-95">
                <IconAvatar iconKey={row.resolvedProfile.icon_key ?? 'zap'} size={12} className="h-8 w-8 ring-2 ring-[#00C896]/20" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-white uppercase tracking-tight">{row.resolvedProfile.display_name}</p>
                  <p className="text-[10px] text-[#00C896] font-mono tracking-tighter opacity-70">{shortenAddress(row.resolvedProfile.wallet_address, 6, 6)}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <input type="text" value={row.walletInput} onChange={e => onChange({ walletInput: e.target.value.trim() })}
              placeholder="Solana wallet address"
              className="w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3.5 text-[11px] font-mono text-white placeholder:text-[#3A4A6E] outline-none focus:border-[#00C896] transition-all shadow-inner" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="relative group">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-[#4E638A] text-sm group-focus-within:text-[#00C896] transition-colors">$</span>
            <input type="number" value={row.amount} onChange={e => onChange({ amount: e.target.value })}
              placeholder="0.00"
              className="w-full rounded-xl border border-[#1A2235] bg-[#081122] pl-8 pr-4 py-3.5 text-sm font-black text-white outline-none focus:border-[#00C896] transition-all shadow-inner placeholder:text-[#3A4A6E]" />
          </div>
          <div className="relative">
            <input type="text" value={row.memo} onChange={e => onChange({ memo: e.target.value })}
              placeholder="Private memo"
              className="w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3.5 text-xs font-medium text-white outline-none focus:border-[#00C896] transition-all shadow-inner placeholder:text-[#3A4A6E]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PayrollPage() {
  const router = useRouter();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const employerWallet = publicKey?.toBase58() ?? '';
  const currentUser = getOnboardedUser();

  const [view, setView] = useState<'list' | 'create'>('list');
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [directPayingId, setDirectPayingId] = useState<string | null>(null);
  const [directPayResult, setDirectPayResult] = useState<{ payrollId: string; sigs: string[] } | null>(null);
  const [expandedPayrolls, setExpandedPayrolls] = useState<Record<string, boolean>>({});

  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([newRow()]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [editingPayrollId, setEditingPayrollId] = useState<string | null>(null);

  const loadPayrolls = useCallback(async () => {
    if (!employerWallet) return;
    setIsLoading(true);
    try { setPayrolls(await fetchPayrolls(employerWallet)); }
    catch { /* silent */ }
    finally { setIsLoading(false); }
  }, [employerWallet]);

  useEffect(() => { if (view === 'list') void loadPayrolls(); }, [view, loadPayrolls]);

  async function handleExportPayrolls() {
    if (!employerWallet) return;

    setIsExporting(true);
    setListError('');

    try {
      const blob = await downloadPayrollCsv(employerWallet);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payroll-groups-${employerWallet.slice(0, 8)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setListError(err?.response?.data?.message || 'Failed to export payroll groups');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!employerWallet) return;
    setRemovingId(id);
    try { 
      await deactivatePayroll(id, employerWallet); 
      setPayrolls(prev => prev.filter(s => s.id !== id));
    } catch { /* silent */ }
    finally { setRemovingId(null); }
  }

  async function handleDirectPay(p: Payroll) {
    if (!publicKey || !p.members.length) return;
    setDirectPayingId(p.id);
    setDirectPayResult(null);
    try {
      const { transactions, recipients: returnedRecipients } = await initiateMultiPayment({
        sender_pubkey: employerWallet,
        recipients: p.members.map(m => ({
          wallet_address: m.wallet_address,
          amount_usdc: m.amount_usdc,
          label: m.display_name ?? m.label ?? undefined,
          memo: m.memo ?? undefined,
        })),
      });

      const sigs: string[] = [];
      for (const tBase64 of transactions) {
        const tx = Transaction.from(Buffer.from(tBase64, 'base64'));
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        sigs.push(sig);
      }

      const CHUNK_SIZE = 10;
      await confirmBulkPayment({
        sender_wallet: employerWallet,
        recipients: returnedRecipients.map((r, i) => {
          const chunkIndex = Math.floor(i / CHUNK_SIZE);
          return {
            wallet_address: r.wallet_address,
            amount_usdc: r.amount_usdc,
            signature: sigs[chunkIndex] ?? sigs[0],
            label: r.label,
          };
        }),
      });

      setDirectPayResult({ payrollId: p.id, sigs });
    } catch (err: any) {
      setListError(err?.response?.data?.message || 'Direct payment failed');
    } finally {
      setDirectPayingId(null);
    }
  }

  const patchMember = useCallback((rowId: string, patch: Partial<MemberRow>) => {
    setMembers(prev => prev.map(r => r.rowId === rowId ? { ...r, ...patch } : r));
  }, []);

  const removeMember = useCallback((rowId: string) => {
    setMembers(prev => prev.filter(r => r.rowId !== rowId));
  }, []);

  const editPayroll = useCallback((p: Payroll) => {
    setEditingPayrollId(p.id);
    setTitle(p.title);
    setMembers(p.members.map(m => ({
      rowId: crypto.randomUUID(),
      mode: m.username ? 'username' : 'wallet',
      usernameInput: m.username || '',
      walletInput: m.wallet_address || '',
      labelInput: m.label || '',
      lookupState: m.username ? 'found' : 'idle',
      resolvedProfile: m.username ? {
        id: m.worker_id!,
        username: m.username,
        display_name: m.display_name!,
        wallet_address: m.wallet_address,
        icon_key: m.icon_key!,
      } as UserProfile : null,
      amount: m.amount_usdc.toString(),
      memo: m.memo || '',
    })));
    setView('create');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingPayrollId(null);
    setTitle('');
    setMembers([newRow()]);
    setView('list');
  }, []);

  const togglePayrollMembers = useCallback((payrollId: string) => {
    setExpandedPayrolls(prev => ({ ...prev, [payrollId]: !prev[payrollId] }));
  }, []);

  async function handleCreate(email: string | null) {
    setShowEmailModal(false);
    setIsCreating(true);
    setError('');
    try {
      const payload = {
        employer_wallet: employerWallet,
        title: title.trim(),
        notification_email: email || undefined,
        members: members.map(m => ({
          username: m.mode === 'username' ? m.resolvedProfile?.username : undefined,
          wallet_address: m.mode === 'wallet' ? m.walletInput : undefined,
          label: m.labelInput || undefined,
          amount_usdc: Number(m.amount),
          memo: m.memo || undefined,
        })),
      };

      if (editingPayrollId) {
        await updatePayroll(editingPayrollId, payload);
      } else {
        await createPayroll(payload);
      }
      
      setView('list');
      setEditingPayrollId(null);
      setTitle('');
      setMembers([newRow()]);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to process payroll');
    } finally {
      setIsCreating(false);
    }
  }

  const totalUsdc = members.reduce((s, m) => s + (Number(m.amount) || 0), 0);

  const hasErrors = !title.trim() || members.some(m => {
    if (m.mode === 'username') return !m.resolvedProfile || m.lookupState !== 'found';
    if (m.mode === 'wallet') return !m.walletInput.trim() || m.walletInput.length < 32;
    return false;
  }) || members.some(m => !m.amount || isNaN(Number(m.amount)) || Number(m.amount) <= 0);

  return (
    <div className="max-w-4xl mx-auto">
      {showEmailModal && <EmailModal onConfirm={handleCreate} onCancel={() => setShowEmailModal(false)} />}

      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl text-white tracking-tight">
            {view === 'list' ? 'Payroll Groups' : editingPayrollId ? 'Edit Payroll' : 'Create Payroll'}
          </h1>
          <p className="mt-2 text-sm text-[#8896B3] max-w-md leading-relaxed">
            {view === 'list' 
              ? 'Organize your workforce into groups for streamlined, automated payouts.' 
              : 'Define group members and their individual USDC allocation.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {view === 'list' ? (
            <>
              <button
                onClick={handleExportPayrolls}
                disabled={isExporting || !employerWallet}
                className="flex items-center gap-2 rounded-xl border border-[#1A2235] bg-[#0A0F1E] px-4 py-3.5 text-sm font-bold text-white transition-all hover:border-[#2C3B5E] hover:bg-white/5 disabled:opacity-40"
              >
                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                <span>Export CSV</span>
              </button>
              <button onClick={() => { setEditingPayrollId(null); setTitle(''); setMembers([newRow()]); setView('create'); }} 
                className="group relative flex items-center gap-2 rounded-xl bg-[#00C896] px-6 py-3.5 text-sm font-black text-[#0A0F1E] hover:bg-[#00E5AC] transition-all shadow-xl shadow-[#00C896]/20 overflow-hidden active:scale-[0.98]">
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                <Plus size={18} className="group-hover:rotate-90 transition-transform duration-300" /> 
                <span className="uppercase tracking-widest">New Group</span>
              </button>
            </>
          ) : (
            <button onClick={cancelEdit} 
              className="flex items-center gap-2 rounded-xl border border-[#1A2235] bg-[#0A0F1E] px-6 py-3.5 text-sm font-bold text-[#8896B3] hover:text-white hover:border-[#2C3B5E] transition-all uppercase tracking-widest">
              Cancel
            </button>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          {listError && (
            <div className="mb-6 rounded-2xl bg-[#FF5F82]/10 border border-[#FF5F82]/20 p-4 flex items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-3">
                <AlertTriangle size={18} className="text-[#FF5F82]" />
                <p className="text-sm font-bold text-[#FF5F82]">{listError}</p>
              </div>
              <button onClick={() => setListError('')} className="text-[#8896B3] hover:text-white">✕</button>
            </div>
          )}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={32} className="animate-spin text-[#00C896]" />
              <p className="text-sm text-[#8896B3]">Loading payrolls...</p>
            </div>
          ) : payrolls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center rounded-[32px] border border-dashed border-[#1A2235] bg-[#0D1B35]/30">
              <div className="h-20 w-20 rounded-3xl bg-[#1A2235] flex items-center justify-center mb-6">
                <Zap size={32} className="text-[#4E638A]" />
              </div>
              <h3 className="text-xl font-bold text-white">No payrolls yet</h3>
              <p className="text-sm text-[#8896B3] max-w-xs mt-2 mb-8">
                Create a group payroll to start managing automated employee payments.
              </p>
              <button onClick={() => setView('create')} 
                className="flex items-center gap-2 rounded-xl bg-[#00C896] px-6 py-3 text-sm font-bold text-[#0A0F1E] hover:bg-[#00B085] transition-all">
                <Plus size={18} /> Get Started
              </button>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {payrolls.map((s) => (
                <div key={s.id} className="group relative rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-7 hover:border-[#00C896]/40 transition-all shadow-xl hover:shadow-2xl hover:shadow-[#00C896]/5 overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity pointer-events-none">
                    <Zap size={120} className="text-[#00C896]" />
                  </div>

                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-3 mb-6">
                      <div className="min-w-0">
                        <h4 className="font-black text-white text-xl truncate tracking-tight">{s.title}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black text-[#4E638A] uppercase tracking-[0.2em]">Group ID</span>
                          <span className="text-[10px] font-bold text-[#8896B3] font-mono">{s.id.slice(0, 8)}...</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => editPayroll(s)}
                          className="p-2.5 rounded-xl text-[#4E638A] hover:bg-white/5 hover:text-white transition-all active:scale-95"
                          title="Edit group"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeactivate(s.id)}
                          disabled={removingId === s.id}
                          className="p-2.5 rounded-xl text-[#4E638A] hover:bg-[#FF5F82]/10 hover:text-[#FF5F82] transition-all active:scale-95 disabled:opacity-50"
                          title="Deactivate group"
                        >
                          {removingId === s.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-baseline gap-2 mb-8">
                      <span className="text-4xl font-black text-white tracking-tighter">${s.total_usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      <span className="text-[10px] font-black text-[#00C896] uppercase tracking-[0.2em] bg-[#00C896]/10 px-2.5 py-1 rounded-full border border-[#00C896]/20 shadow-sm">USDC Total</span>
                    </div>

                    <div className="flex items-center justify-between mb-8 p-4 rounded-2xl bg-black/20 border border-white/5">
                      <div className="flex -space-x-3.5">
                        {s.members.slice(0, 4).map((m, i) => (
                          <div key={m.id} className="relative ring-4 ring-[#0D1B35] rounded-full overflow-hidden transition-transform hover:-translate-y-1 hover:z-20">
                            <IconAvatar iconKey={m.icon_key ?? 'zap'} size={12} className="h-9 w-9" />
                          </div>
                        ))}
                        {s.member_count > 4 && (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1A2235] text-[10px] font-black text-white ring-4 ring-[#0D1B35] relative z-[0]">
                            +{s.member_count - 4}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-[#4E638A] uppercase tracking-widest mb-0.5">Workforce</p>
                        <span className="text-xs font-bold text-white">
                          {s.member_count} {s.member_count === 1 ? 'Individual' : 'Members'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => togglePayrollMembers(s.id)}
                        className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-black/10 px-4 py-3 text-left transition-all hover:border-[#00C896]/20 hover:bg-white/5"
                      >
                        <div>
                          <p className="text-[10px] font-black text-[#4E638A] uppercase tracking-[0.2em]">Members</p>
                          <p className="mt-1 text-xs font-bold text-white">
                            {expandedPayrolls[s.id] ? 'Hide payroll members' : `Show ${s.member_count} payroll members`}
                          </p>
                        </div>
                        {expandedPayrolls[s.id] ? <ChevronUp size={16} className="text-[#8896B3]" /> : <ChevronDown size={16} className="text-[#8896B3]" />}
                      </button>

                      {expandedPayrolls[s.id] ? (
                        <div className="space-y-3">
                          {s.members.map((m) => (
                            <div key={m.id} className="flex items-center gap-3">
                              <div className="h-2 w-2 rounded-full bg-[#00C896]/40" />
                              <span className="text-[11px] font-bold text-[#D6DEEE] truncate flex-1 tracking-wide">
                                {m.display_name ?? m.label ?? shortenAddress(m.wallet_address, 4, 4)}
                              </span>
                              <span className="text-[11px] font-black text-white tracking-tight">${m.amount_usdc}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          {s.members.slice(0, 2).map((m) => (
                            <div key={m.id} className="flex items-center gap-3">
                              <div className="h-2 w-2 rounded-full bg-[#00C896]/40" />
                              <span className="text-[11px] font-bold text-[#D6DEEE] truncate flex-1 tracking-wide">
                                {m.display_name ?? m.label ?? shortenAddress(m.wallet_address, 4, 4)}
                              </span>
                              <span className="text-[11px] font-black text-white tracking-tight">${m.amount_usdc}</span>
                            </div>
                          ))}
                          {s.member_count > 2 && (
                            <p className="text-[9px] font-black text-[#4E638A] uppercase tracking-[0.15em] ml-5">+{s.member_count - 2} additional recipients</p>
                          )}
                        </>
                      )}
                    </div>

                    <div className="mt-6 pt-6 border-t border-white/5">
                      <button 
                        onClick={() => handleDirectPay(s)}
                        disabled={directPayingId === s.id}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#00C896] py-3 text-sm font-black text-[#0A0F1E] hover:bg-[#00E5AC] transition-all disabled:opacity-50"
                      >
                        {directPayingId === s.id ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />}
                        <span className="uppercase tracking-widest">Pay Directly</span>
                      </button>
                      
                      {directPayResult?.payrollId === s.id && (
                        <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-bold text-[#00C896]">
                          <CheckCircle2 size={12} />
                          <span>Bulk payment sent!</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="flex flex-col gap-6">
            <section className="rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-8 shadow-xl">
              <div className="mb-8">
                <label className="mb-3 block text-sm font-black text-[#4E638A] uppercase tracking-[0.2em] ml-1">Group Identification</label>
                <div className="relative group">
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Core Engineering Team"
                    className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-4 text-white outline-none focus:border-[#00C896] transition-all hover:border-[#2C3B5E] shadow-inner font-medium" />
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 opacity-20 group-hover:opacity-40 transition-opacity">
                    <Mail size={18} />
                  </div>
                </div>
              </div>

              <div className="mb-6 flex items-center justify-between px-1">
                <h3 className="text-[11px] font-black text-[#4E638A] uppercase tracking-[0.2em]">Group Composition</h3>
                <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold text-[#8896B3] uppercase tracking-wider">Accumulated Total:</span>
                   <span className="text-sm font-black text-[#00C896] tracking-tight">
                    ${totalUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {members.map(row => (
                  <MemberRowCard key={row.rowId} row={row} onPatch={patchMember} onRemove={removeMember} canRemove={members.length > 1} />
                ))}
                <button type="button" onClick={() => setMembers(p => [...p, newRow()])}
                  className="group mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#1A2235] py-5 text-sm font-bold text-[#8896B3] hover:border-[#00C896]/30 hover:bg-[#00C896]/5 hover:text-[#00C896] transition-all duration-300">
                  <Plus size={18} className="group-hover:rotate-90 transition-transform duration-300" /> 
                  <span className="uppercase tracking-widest">Append Member</span>
                </button>
              </div>

              {error && (
                <div className="mt-8 rounded-2xl bg-[#FF5F82]/5 border border-[#FF5F82]/20 p-5 flex items-start gap-3 animate-shake">
                  <CircleAlert size={18} className="shrink-0 text-[#FF5F82] mt-0.5" />
                  <p className="text-sm font-bold text-[#FF5F82] tracking-wide">{error}</p>
                </div>
              )}

              <button onClick={() => setShowEmailModal(true)} disabled={isCreating || !employerWallet || hasErrors}
                className="group relative mt-10 flex w-full items-center justify-center gap-3 rounded-[20px] bg-[#00C896] py-5 text-lg font-black text-[#0A0F1E] hover:bg-[#00E5AC] active:scale-[0.98] transition-all shadow-xl shadow-[#00C896]/20 disabled:opacity-40 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                {isCreating ? (
                  <Loader2 className="animate-spin" size={24} />
                ) : (
                  <>
                    <Zap size={22} className="group-hover:scale-110 transition-transform" /> 
                    <span className="uppercase tracking-[0.1em]">{editingPayrollId ? 'Commit Changes' : 'Initialize Payroll'}</span>
                  </>
                )}
              </button>
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-5">
              <h4 className="text-xs font-bold text-[#00C896] uppercase tracking-widest mb-3">Next Step</h4>
              <div className="flex gap-3">
                <Zap size={18} className="shrink-0 text-[#FFD166]" />
                <p className="text-xs text-[#8896B3] leading-relaxed">
                  After creating this group, you'll be redirected to the <strong className="text-white">Payments</strong> page to set up the recurring schedule.
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-5">
              <h4 className="text-xs font-bold text-[#4E638A] uppercase tracking-widest mb-3">Info</h4>
              <div className="flex gap-3">
                <CircleAlert size={18} className="shrink-0 text-[#4E638A]" />
                <p className="text-xs text-[#8896B3] leading-relaxed">
                  Group payrolls use a program-controlled vault. You only need to fund it once per cycle.
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
