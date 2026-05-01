'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, ArrowRight, Building, Landmark, Hash, Banknote } from 'lucide-react';
import { getOfframpRate, initiateOffRamp } from '@/lib/api';
import { useSolanaBalance } from '@/hooks/useSolanaBalance';

export default function OffRampPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const { data: balance, isLoading: isLoadingBalance } = useSolanaBalance();
  
  const [amount, setAmount] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [status, setStatus] = useState<'idle' | 'quoting' | 'ready' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [rateData, setRateData] = useState<any>(null);
  const [ngnAmount, setNgnAmount] = useState<number | null>(null);

  useEffect(() => {
    // Fetch rate on load
    getOfframpRate()
      .then(setRateData)
      .catch(() => setErrorMsg('Failed to load current exchange rate.'));
  }, []);

  const handleAmountChange = (val: string) => {
    setAmount(val);
    if (!val || !rateData) {
      setNgnAmount(null);
      return;
    }
    const usdc = parseFloat(val);
    if (isNaN(usdc)) return;
    const fee = usdc * (rateData.feePct / 100);
    const net = usdc - fee;
    setNgnAmount(Math.floor(net * rateData.usdcToNgn));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet) {
      setErrorMsg('Wallet not connected.');
      return;
    }
    if (!amount || !bankCode || !accountNumber || !accountName) {
      setErrorMsg('Please fill all fields.');
      return;
    }

    setStatus('loading');
    setErrorMsg(null);

    try {
      const result = await initiateOffRamp({
        workerWallet: wallet,
        amountUSDC: parseFloat(amount),
        bankCode,
        accountNumber,
        accountName,
      });

      setStatus('success');
      // result contains reference, etaMinutes, amountNGN
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err?.response?.data?.message || err.message || 'Failed to initiate off-ramp.');
    }
  };

  return (
    <div className="flex flex-col gap-8 max-w-3xl mx-auto">
      <div>
        <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl text-white">Off-Ramp</h1>
        <p className="mt-2 text-sm text-[#8896B3]">Withdraw your USDC directly to your local bank account in NGN.</p>
      </div>

      <section className="rounded-[32px] border border-[#1A2235] bg-gradient-to-b from-[#0D1B35] to-[#0A0F1E] p-8 shadow-xl shadow-black/20">
        
        {status === 'success' ? (
          <div className="text-center py-12 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-20 h-20 bg-[#00C896]/20 rounded-full flex items-center justify-center text-[#00C896]">
              <Banknote size={40} />
            </div>
            <h2 className="text-2xl font-bold text-white">Withdrawal Initiated!</h2>
            <p className="text-[#8896B3] max-w-md mx-auto">
              Your funds are on the way to your bank account. It typically takes less than 15 minutes to arrive.
            </p>
            <button 
              onClick={() => { setStatus('idle'); setAmount(''); setAccountNumber(''); setAccountName(''); }}
              className="mt-6 px-6 py-3 bg-[#1A2235] text-white font-bold rounded-xl hover:bg-[#2C3B5E] transition-colors"
            >
              Make Another Withdrawal
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {errorMsg && (
              <div className="bg-[#FF5F82]/10 border border-[#FF5F82]/20 text-[#FF5F82] p-4 rounded-xl text-sm font-medium">
                {errorMsg}
              </div>
            )}
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-[#8896B3] uppercase tracking-wider">Amount (USDC)</label>
              <div className="relative">
                <input 
                  type="number" 
                  value={amount} 
                  onChange={e => handleAmountChange(e.target.value)}
                  disabled={status === 'loading'}
                  className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl pl-4 pr-16 py-4 focus:border-[#00C896] outline-none text-white text-lg font-mono placeholder:text-[#4E638A] transition-colors"
                  placeholder="100.00"
                  step="0.01"
                  min="5"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <span className="text-[#8896B3] font-bold">USDC</span>
                </div>
              </div>
              <p className="text-xs text-[#4E638A]">Available Balance: <span className="font-mono text-[#8896B3]">{isLoadingBalance ? '...' : (balance?.usdc ?? 0).toFixed(2)} USDC</span></p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-[#8896B3] uppercase tracking-wider">Bank Name</label>
                <div className="relative">
                  <Building size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#4E638A]" />
                  <select
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    disabled={status === 'loading'}
                    className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl pl-12 pr-4 py-4 focus:border-[#00C896] outline-none text-white appearance-none transition-colors"
                  >
                    <option value="" disabled>Select your bank</option>
                    <option value="044">Access Bank</option>
                    <option value="011">First Bank of Nigeria</option>
                    <option value="058">Guaranty Trust Bank (GTB)</option>
                    <option value="033">United Bank for Africa (UBA)</option>
                    <option value="057">Zenith Bank</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-[#8896B3] uppercase tracking-wider">Account Number</label>
                <div className="relative">
                  <Hash size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#4E638A]" />
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    disabled={status === 'loading'}
                    className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl pl-12 pr-4 py-4 focus:border-[#00C896] outline-none text-white font-mono placeholder:text-[#4E638A] transition-colors"
                    placeholder="0123456789"
                    maxLength={10}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-[#8896B3] uppercase tracking-wider">Account Name</label>
              <div className="relative">
                <Landmark size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#4E638A]" />
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  disabled={status === 'loading'}
                  className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl pl-12 pr-4 py-4 focus:border-[#00C896] outline-none text-white placeholder:text-[#4E638A] transition-colors"
                  placeholder="John Doe"
                />
              </div>
            </div>

            <div className="bg-[#0A0F1E] border border-[#1A2235] rounded-xl p-5 flex flex-col gap-3 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#8896B3]">Exchange Rate</span>
                <span className="text-sm text-white font-mono">{rateData ? `1 USDC = ₦${rateData.usdcToNgn}` : '---'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#8896B3]">Fee</span>
                <span className="text-sm text-[#FF5F82] font-mono">{rateData ? `${rateData.feePct}%` : '---'}</span>
              </div>
              <div className="h-px bg-[#1A2235] w-full my-1"></div>
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-white">You Receive (Est.)</span>
                <span className="text-2xl font-black text-[#00C896] font-mono">
                  {ngnAmount ? `₦${ngnAmount.toLocaleString()}` : '---'}
                </span>
              </div>
            </div>

            <button 
              type="submit"
              disabled={status === 'loading' || !amount || !bankCode || !accountNumber || !accountName || !rateData}
              className="w-full bg-[#00C896] text-[#0A0F1E] font-bold py-4 mt-2 rounded-xl hover:bg-[#00B085] hover:shadow-[0_0_20px_rgba(0,200,150,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:shadow-none"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Withdraw to Bank
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
