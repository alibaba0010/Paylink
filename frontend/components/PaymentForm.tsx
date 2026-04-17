'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { api } from '@/lib/api';
import { WalletConnectButton } from '@/components/WalletConnectButton';

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

  async function handlePay() {
    if (!connected || !publicKey || !recipientWallet) return;

    const parsedAmount = Number.parseFloat(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatus('error');
      return;
    }

    setStatus('building');

    try {
      // 1. Ask our API to build the unsigned transaction
      const { data } = await api.post('/payments/initiate', {
        link_id:       linkId,
        recipient_username: recipientUsername,
        recipient_wallet: recipientWallet,
        sender_pubkey: publicKey.toString(),
        amount_usdc:   parsedAmount,
        memo,
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
        link_id:   linkId,
        recipient_wallet: recipientWallet,
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

  const isSelfPayment = connected && publicKey?.toBase58() === recipientWallet;

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
            disabled={(status !== 'idle' && status !== 'error') || !recipientWallet}
            className="w-full bg-[#00C896] text-[#0A0F1E] font-bold py-4
                       rounded-xl text-base sm:text-lg hover:bg-[#00B085] transition-colors
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {buttonLabel[status]}
          </button>

          {/* Success — show explorer link */}
          {status === 'done' && txSig && (
            <a
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-[#00C896] text-sm hover:underline"
            >
              View on Solscan ↗
            </a>
          )}
        </>
      )}
    </div>
  );
}
