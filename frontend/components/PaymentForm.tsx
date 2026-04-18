'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { api } from '@/lib/api';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

type Status = 'idle' | 'building' | 'signing' | 'confirming' | 'done' | 'error';

interface PaymentFormProps {
  linkId?:            string;
  recipientUsername:  string;
  recipientWallet:    string;
  fixedAmount:        number | null;
}

export function PaymentForm({
  linkId,
  recipientUsername,
  recipientWallet,
  fixedAmount,
}: PaymentFormProps) {
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [amount, setAmount] = useState(fixedAmount?.toString() || '');
  const [memo,   setMemo]   = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [txSig,  setTxSig]  = useState('');
  const [isCustomWallet, setIsCustomWallet] = useState(false);
  const [customWallet, setCustomWallet] = useState('');

  async function handlePay() {
    const finalRecipientWallet = isCustomWallet ? customWallet : recipientWallet;
    
    if (!connected || !publicKey || !finalRecipientWallet) return;

    const parsedAmount = Number.parseFloat(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatus('error');
      return;
    }

    setStatus('building');

    try {
      // 1. Ask our API to build the unsigned transaction
      const { data } = await api.post('/payments/initiate', {
        link_id:       isCustomWallet ? undefined : linkId,
        recipient_username: isCustomWallet ? 'Wallet Address' : recipientUsername,
        recipient_wallet: finalRecipientWallet,
        sender_pubkey: publicKey.toString(),
        amount_usdc:   parsedAmount,
        memo,
        use_escrow:    false, // Switch to direct payment for now
      });

      // 2. Deserialize and send to wallet for signing
      setStatus('signing');
      const tx  = Transaction.from(Buffer.from(data.transaction, 'base64'));
      const sig = await sendTransaction(tx, connection);

      // 3. Wait for Solana confirmation
      setStatus('confirming');
      await connection.confirmTransaction(sig, 'confirmed');

      // 4. Notify our backend so it updates the DB and sends notifications
      await api.post('/payments/confirm', {
        signature: sig,
        link_id:   isCustomWallet ? undefined : linkId,
        recipient_wallet: finalRecipientWallet,
      });

      setTxSig(sig);
      setStatus('done');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
    }
  }

  const buttonLabel: Record<Status, string> = {
    idle:       `Pay ${amount ? `$${amount} USDC` : 'with USDC'}`,
    building:   'Preparing transaction...',
    signing:    'Confirm in your wallet...',
    confirming: 'Confirming on Solana...',
    done:       '✅ Payment sent!',
    error:      '❌ Failed — try again',
  };

  const finalRecipientWallet = isCustomWallet ? customWallet : recipientWallet;
  
  // Self-payout check: current user cannot send to their own wallet OR their own username
  const currentUser = typeof window !== 'undefined' ? (JSON.parse(window.localStorage.getItem('paylink.onboarded-user') || '{}')) : null;
  const isSelfWallet = connected && publicKey?.toBase58() === finalRecipientWallet;
  const isSelfUsername = connected && currentUser?.username && recipientUsername === currentUser.username;
  const isSelfPayment = isSelfWallet || isSelfUsername;

  return (
    <div className="flex flex-col gap-4">
      {!connected ? (
        <WalletConnectButton className="!h-12 !w-full !rounded-xl !bg-[#00C896] !font-bold !text-[#0A0F1E]" />
      ) : isSelfPayment ? (
        <div className="rounded-xl border border-[#FF5F82]/30 bg-[#FF5F82]/10 p-4 text-center text-[#FF5F82]">
          You cannot send money to your own connected wallet.
        </div>
      ) : (
        <>
          {/* Recipient Selector Toggle */}
          {!isCustomWallet ? (
            <button
              onClick={() => setIsCustomWallet(true)}
              className="text-left text-xs text-[#00C896] hover:underline mb-1"
            >
              + Send to a different wallet address
            </button>
          ) : (
            <div className="flex flex-col gap-2 mb-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#8896B3]">Recipient Wallet Address</label>
                <button
                  onClick={() => {
                    setIsCustomWallet(false);
                    setCustomWallet('');
                  }}
                  className="text-xs text-[#FF5F82] hover:underline"
                >
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={customWallet}
                onChange={(e) => setCustomWallet(e.target.value)}
                placeholder="Enter Solana wallet address"
                className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl
                           px-4 py-3 text-sm text-white focus:border-[#00C896]
                           focus:outline-none transition-colors"
              />
            </div>
          )}

          {/* Amount, Memo, and Pay Button — only show if we have a recipient */}
          {(isCustomWallet || !!recipientWallet) && (
            <div className="mt-4 flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Amount */}
              {!fixedAmount && (
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8896B3] font-bold">$</span>
                  <input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl
                               pl-8 pr-16 py-3 text-white text-lg focus:border-[#00C896]
                               focus:outline-none transition-colors"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8896B3] text-sm">USDC</span>
                </div>
              )}

              {/* Memo */}
              <input
                type="text"
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="What is this for? (optional)"
                className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl
                           px-4 py-3 text-sm text-white sm:text-base focus:border-[#00C896]
                           focus:outline-none transition-colors"
              />

              {/* Pay Button */}
              <button
                onClick={handlePay}
                disabled={(status !== 'idle' && status !== 'error') || !finalRecipientWallet}
                className="w-full bg-[#00C896] text-[#0A0F1E] font-bold py-4
                           rounded-xl text-base sm:text-lg hover:bg-[#00B085] transition-colors
                           disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {buttonLabel[status]}
              </button>
            </div>
          )}

          {/* Success — show explorer link */}
          {status === 'done' && txSig && (
            <div className="mt-6 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95">
              <div className="h-16 w-16 rounded-full bg-[#00C896]/10 flex items-center justify-center text-[#00C896]">
                <CheckCircle2 size={40} />
              </div>
              <div className="text-center">
                <p className="text-white font-black uppercase tracking-widest text-sm">Payment Successful</p>
                <a
                  href={`https://solscan.io/tx/${txSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center justify-center gap-2 text-[#8896B3] text-xs hover:text-[#00C896] transition-colors group"
                >
                  View on Solscan <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </a>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
