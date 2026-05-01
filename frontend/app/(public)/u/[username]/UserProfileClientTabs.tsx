'use client';

import { useState } from 'react';
import { PaymentForm } from '@/components/PaymentForm';
import { CrossChainPaymentForm } from '@/components/CrossChainPaymentForm';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';

interface UserProfileClientTabsProps {
  profile: any;
  username: string;
  pageUrl: string;
}

export function UserProfileClientTabs({ profile, username, pageUrl }: UserProfileClientTabsProps) {
  const [activeTab, setActiveTab] = useState<'solana' | 'ethereum'>('solana');

  return (
    <>
      <div className="w-full rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-5 shadow-2xl shadow-black/30 sm:p-6">
        <h2 className="mb-4 text-center font-semibold text-white">
          Pay {profile.display_name}
        </h2>
        
        <div className="flex gap-2 p-1 rounded-xl bg-[#081122] border border-[#1A2235] mb-6">
          <button
            onClick={() => setActiveTab('solana')}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${
              activeTab === 'solana' 
                ? 'bg-[#00C896] text-[#0A0F1E]' 
                : 'text-[#8896B3] hover:text-white hover:bg-[#1A2235]'
            }`}
          >
            Solana
          </button>
          <button
            onClick={() => setActiveTab('ethereum')}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${
              activeTab === 'ethereum' 
                ? 'bg-[#3B82F6] text-white' 
                : 'text-[#8896B3] hover:text-white hover:bg-[#1A2235]'
            }`}
          >
            Ethereum
          </button>
        </div>

        {activeTab === 'solana' ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <PaymentForm
              linkId={profile.default_link_id}
              recipientUsername={username}
              recipientWallet={profile.wallet_address}
              fixedAmount={null}
            />
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <CrossChainPaymentForm
              recipientUsername={username}
              recipientWallet={profile.wallet_address}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 text-center">
        <p className="text-xs text-[#8896B3]">Scan to pay on {activeTab === 'solana' ? 'Solana' : 'Ethereum'}</p>
        <QRCodeDisplay url={pageUrl} size={120} />
        <p className="break-all text-xs font-mono text-[#8896B3]">{pageUrl}</p>
      </div>
    </>
  );
}
