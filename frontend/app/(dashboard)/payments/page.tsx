'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { BadgeCheck, Loader2, Calendar, History, ArrowRightLeft, Clock, Plus, ExternalLink, Zap } from 'lucide-react';
import { fetchPayrolls, fetchUserProfile, schedulePayroll, executePayroll, type Payroll, type UserProfile } from '@/lib/api';
import { IconAvatar } from '@/components/IconPicker';
import { shortenAddress } from '@/lib/format';
import { PaymentForm } from '@/components/PaymentForm';
import { CopyValueButton } from '@/components/CopyValueButton';

type Tab = 'single' | 'payroll' | 'history';

export default function PaymentsPage() {
  const { publicKey } = useWallet();
  const employerWallet = publicKey?.toBase58() ?? '';
  const [activeTab, setActiveTab] = useState<Tab>('single');

  // Single payment state
  const [username, setUsername] = useState('');
  const [recipient, setRecipient] = useState<UserProfile | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'searching' | 'found' | 'not-found' | 'error'>('idle');

  // Recurring state
  const [schedules, setSchedules] = useState<Payroll[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [selectedPayrollId, setSelectedPayrollId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [isScheduling, setIsScheduling] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<{ type: 'schedule' | 'execute', text: string } | null>(null);

  // Lookup effect
  useEffect(() => {
    const q = username.trim().toLowerCase().replace(/^@/, '');
    if (q.length < 3) { setRecipient(null); setLookupState('idle'); return; }
    setLookupState('searching');
    const t = window.setTimeout(() => {
      void fetchUserProfile(q).then(p => {
        if (!p) { setRecipient(null); setLookupState('not-found'); return; }
        setRecipient(p); setLookupState('found');
      }).catch(() => { setRecipient(null); setLookupState('error'); });
    }, 400);
    return () => window.clearTimeout(t);
  }, [username]);

  const loadSchedules = useCallback(async () => {
    if (!employerWallet) return;
    setIsLoadingSchedules(true);
    try { setSchedules(await fetchPayrolls(employerWallet)); }
    catch { /* silent */ }
    finally { setIsLoadingSchedules(false); }
  }, [employerWallet]);

  const handleActivateSchedule = useCallback(async () => {
    if (!selectedPayrollId || !employerWallet) return;
    setIsScheduling(true);
    setSuccessMessage(null);
    try {
      await schedulePayroll(selectedPayrollId, employerWallet, frequency);
      setSuccessMessage({ type: 'schedule', text: `Successfully scheduled ${frequency} payments.` });
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to schedule payroll');
    } finally {
      setIsScheduling(false);
    }
  }, [selectedPayrollId, employerWallet, frequency]);

  const handleExecuteNow = useCallback(async () => {
    if (!selectedPayrollId || !employerWallet) return;
    setIsExecuting(true);
    setSuccessMessage(null);
    try {
      await executePayroll(selectedPayrollId, employerWallet);
      setSuccessMessage({ type: 'execute', text: 'Payroll execution triggered successfully!' });
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to execute payroll');
    } finally {
      setIsExecuting(false);
    }
  }, [selectedPayrollId, employerWallet]);

  useEffect(() => { if (activeTab === 'payroll') void loadSchedules(); }, [activeTab, loadSchedules]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">Payments</h1>
        <p className="mt-2 text-sm text-[#8896B3]">
          Send direct funds or manage your recurring payment schedules.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 p-1.5 bg-[#0D1B35] rounded-2xl border border-[#1A2235] w-fit">
        {(['single', 'payroll', 'history'] as Tab[]).map((tab) => (
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
            {tab === 'history' && <History size={16} />}
            <span className="capitalize">{tab}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6">
        {activeTab === 'single' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <section className="rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-8 shadow-xl shadow-black/20">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white tracking-tight">Single Payout</h2>
                <p className="text-sm text-[#8896B3] mt-2 leading-relaxed">Instant transfer to any PayLink user or wallet address.</p>
              </div>

              <div className="flex flex-col gap-5">
                <div className="rounded-2xl border border-white/5 bg-[#0A0F1E] p-5">
                  <label className="text-sm font-medium text-white block mb-3">Recipient</label>
                  <div className="relative flex items-center rounded-2xl border border-[#1A2235] bg-[#081122] px-4">
                    <span className="mr-2 text-lg text-[#00C896]">@</span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="username"
                      className="h-14 w-full bg-transparent text-white outline-none placeholder:text-[#53627F]"
                    />
                    {lookupState === 'searching' && <Loader2 size={18} className="animate-spin text-[#8896B3]" />}
                    {lookupState === 'found' && <BadgeCheck size={18} className="text-[#00C896]" />}
                  </div>
                  {lookupState === 'not-found' && <p className="mt-2 text-xs text-[#FF5F82]">User not found.</p>}
                </div>

                {recipient && lookupState === 'found' && (
                  <div className="rounded-2xl border border-[#00C896]/20 bg-[#00C896]/5 p-5 animate-in zoom-in-95 duration-200">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4">
                        <IconAvatar iconKey={recipient.icon_key ?? 'zap'} size={18} className="h-14 w-14" />
                        <div>
                          <p className="text-lg font-semibold text-white">{recipient.display_name}</p>
                          <p className="text-sm text-[#8896B3]">@{recipient.username}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0D1B35] px-3 py-2 text-sm text-[#D6DEEE]">
                        <span className="font-mono">{shortenAddress(recipient.wallet_address, 4, 4)}</span>
                        <CopyValueButton value={recipient.wallet_address} title="Copy wallet" className="h-7 w-7 border-transparent bg-transparent" />
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-white/5">
                  <PaymentForm
                    recipientUsername={recipient?.username ?? ''}
                    recipientWallet={recipient?.wallet_address ?? ''}
                    fixedAmount={null}
                  />
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'payroll' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <section className="rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-8 shadow-xl shadow-black/20">
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00C896]/15 text-[#00C896] shadow-inner">
                    <Zap size={20} />
                  </div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Group Payroll</h2>
                </div>
                <p className="text-sm text-[#8896B3] leading-relaxed">Execute a one-time group payment or set up a recurring schedule.</p>
              </div>

              <div className="flex flex-col gap-8">
                <div className="space-y-3">
                  <label className="text-sm font-bold text-white/90 ml-1 uppercase tracking-wider">Select Payroll Group</label>
                  <div className="relative group">
                    <select 
                      value={selectedPayrollId ?? ''} 
                      onChange={e => setSelectedPayrollId(e.target.value || null)}
                      className="w-full h-16 rounded-2xl border border-[#1A2235] bg-[#081122] px-5 text-white outline-none focus:border-[#00C896] transition-all appearance-none cursor-pointer hover:border-[#2C3B5E] shadow-inner"
                    >
                      <option value="">Choose a group...</option>
                      {schedules.map(p => (
                        <option key={p.id} value={p.id}>{p.title} (${p.total_usdc.toFixed(2)})</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[#8896B3] group-hover:text-[#00C896] transition-colors">
                      <Clock size={18} />
                    </div>
                  </div>
                </div>

                {selectedPayrollId && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="rounded-[24px] border border-white/5 bg-[#0A0F1E]/50 p-6 backdrop-blur-sm relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Zap size={80} className="text-[#00C896]" />
                      </div>
                      
                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-6">
                          <span className="text-[10px] font-black text-[#4E638A] uppercase tracking-[0.2em]">Group Intelligence</span>
                          <div className="flex items-center gap-1.5 rounded-full bg-[#00C896]/10 px-3 py-1 border border-[#00C896]/20">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#00C896] animate-pulse" />
                            <span className="text-[10px] font-bold text-[#00C896] uppercase tracking-wider">
                              {schedules.find(p => p.id === selectedPayrollId)?.member_count} Members
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-end gap-3">
                          <span className="text-4xl font-black text-white tracking-tighter">
                            ${schedules.find(p => p.id === selectedPayrollId)?.total_usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-sm font-bold text-[#8896B3] mb-1.5 uppercase tracking-widest">USDC / Cycle</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-sm font-bold text-white/90 ml-1 uppercase tracking-wider">Payment Frequency</label>
                      <div className="grid grid-cols-3 gap-3">
                        {(['weekly', 'biweekly', 'monthly'] as const).map(f => (
                          <button 
                            key={f}
                            onClick={() => setFrequency(f)}
                            className={`relative h-20 rounded-2xl border transition-all overflow-hidden flex flex-col items-center justify-center gap-1 group ${
                              frequency === f 
                                ? 'bg-[#00C896] border-[#00C896] text-[#0A0F1E] shadow-xl shadow-[#00C896]/20 scale-[1.02]' 
                                : 'border-[#1A2235] bg-[#081122] text-[#8896B3] hover:border-[#2C3B5E] hover:bg-[#0D1B35]'
                            }`}
                          >
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Every</span>
                            <span className="text-sm font-bold uppercase tracking-wide">
                              {f === 'biweekly' ? '2 Weeks' : f === 'weekly' ? 'Week' : 'Month'}
                            </span>
                            {frequency === f && (
                              <div className="absolute top-1.5 right-1.5">
                                <BadgeCheck size={14} />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2.5 px-2 py-3 rounded-xl bg-[#00C896]/5 border border-[#00C896]/10 text-xs text-[#00C896]">
                        <Clock size={14} className="shrink-0" />
                        <p className="font-medium tracking-wide">Next execution will be automatically scheduled for tomorrow at 09:00 UTC.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={handleExecuteNow}
                        disabled={isExecuting || isScheduling}
                        className="group relative flex items-center justify-center gap-3 rounded-[20px] border border-[#00C896] bg-[#00C896]/10 py-5 text-lg font-black text-[#00C896] hover:bg-[#00C896] hover:text-[#0A0F1E] active:scale-[0.98] transition-all disabled:opacity-40"
                      >
                        {isExecuting ? (
                          <Loader2 className="animate-spin" size={24} />
                        ) : (
                          <>
                            <ArrowRightLeft size={22} className="group-hover:translate-x-1 transition-transform" />
                            <span className="uppercase tracking-widest">Execute Now</span>
                          </>
                        )}
                      </button>

                      <button 
                        onClick={handleActivateSchedule}
                        disabled={isScheduling || isExecuting}
                        className="group relative flex items-center justify-center gap-3 rounded-[20px] bg-[#00C896] py-5 text-lg font-black text-[#0A0F1E] hover:bg-[#00E5AC] active:scale-[0.98] transition-all shadow-xl shadow-[#00C896]/20 disabled:opacity-40"
                      >
                        {isScheduling ? (
                          <Loader2 className="animate-spin" size={24} />
                        ) : (
                          <>
                            <Calendar size={22} className="group-hover:scale-110 transition-transform" />
                            <span className="uppercase tracking-widest">Activate Schedule</span>
                          </>
                        )}
                      </button>
                    </div>

                    {successMessage && (
                      <div className="rounded-2xl bg-[#00C896]/10 border border-[#00C896]/20 p-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                        <BadgeCheck size={20} className="text-[#00C896]" />
                        <p className="text-sm font-bold text-[#00C896]">{successMessage.text}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <section className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-20 flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-[#1A2235] flex items-center justify-center mb-4">
                <Clock size={28} className="text-[#4E638A]" />
              </div>
              <h3 className="text-lg font-bold text-white">Payment history coming soon</h3>
              <p className="text-sm text-[#8896B3] max-w-xs mt-1">
                We're building a detailed ledger of all your transaction signatures and confirmations.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
