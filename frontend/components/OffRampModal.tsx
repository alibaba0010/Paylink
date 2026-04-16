'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useWallet } from '@solana/wallet-adapter-react';

export function OffRampModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [ngnAmount, setNgnAmount] = useState<number | null>(null);
  const { publicKey } = useWallet();

  if (!isOpen) return null;

  async function handleQuote() {
    if (!amount) return;
    setStatus('loading');
    try {
      const { data } = await api.get('/offramp/rate');
      // Calculate NGN
      const usdc = parseFloat(amount);
      const fee = usdc * (data.rate.feePct / 100);
      const net = usdc - fee;
      setNgnAmount(Math.floor(net * data.rate.usdcToNgn));
      setStatus('idle');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-4">
      <div className="bg-[#0D1B35] rounded-2xl w-full max-w-md p-6 border border-[#1A2235] relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-[#8896B3] hover:text-white">✕</button>
        <h2 className="text-xl font-bold font-[Space_Grotesk] mb-6">Off-Ramp to Naira</h2>
        
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm text-[#8896B3] mb-1 block">Amount (USDC)</label>
            <input 
              type="number" 
              value={amount} 
              onChange={e => setAmount(e.target.value)}
              onBlur={handleQuote}
              className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl px-4 py-3 focus:border-[#00C896] outline-none"
              placeholder="100.00"
            />
          </div>

          <div className="bg-[#1A2235] rounded-xl p-4 flex justify-between items-center">
            <span className="text-[#8896B3]">You receive (Est.)</span>
            <span className="text-xl font-bold text-[#00C896]">
              {ngnAmount ? `₦${ngnAmount.toLocaleString()}` : '---'}
            </span>
          </div>

          <button 
            className="w-full bg-[#00C896] text-[#0A0F1E] font-bold py-3 mt-4 rounded-xl hover:bg-[#00B085] transition-colors"
            onClick={() => setStatus('success')}
          >
            Confirm & Send
          </button>
        </div>
      </div>
    </div>
  );
}
