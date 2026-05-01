'use client';

import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BrandLogo } from '@/components/BrandLogo';
import { UserAvatar } from '@/components/UserAvatar';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { fetchInvoice, fetchInvoiceComments, addInvoiceComment, payInvoice, api, type Invoice, type InvoiceComment } from '@/lib/api';
import { shortenAddress } from '@/lib/format';
import { Loader2, CheckCircle2, MessageSquare, Send, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';

export default function PublicInvoicePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [comments, setComments] = useState<InvoiceComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Payment state
  const [payStatus, setPayStatus] = useState<'idle' | 'building' | 'signing' | 'confirming' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [txSig, setTxSig] = useState<string | null>(null);

  // Comment state
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  useEffect(() => {
    loadInvoice();
  }, [id]);

  async function loadInvoice() {
    setIsLoading(true);
    try {
      const inv = await fetchInvoice(id);
      setInvoice(inv);
      if (inv) {
        const comms = await fetchInvoiceComments(inv.id);
        setComments(comms);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invoice not found');
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePay() {
    if (!invoice || !connected || !publicKey) return;
    
    setPayStatus('building');
    setErrorMsg('');

    try {
      // 1. Check user balance first
      const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
      const senderATA = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const tokenAccountBalance = await connection.getTokenAccountBalance(senderATA);
      const uiAmount = tokenAccountBalance.value.uiAmount || 0;
      if (uiAmount < invoice.total_usdc) {
        throw new Error(`Insufficient balance. You have ${uiAmount} USDC but need ${invoice.total_usdc} USDC.`);
      }
    } catch (e: any) {
      if (e.message?.includes('could not find account')) {
        setErrorMsg(`Insufficient balance. You have 0 USDC but need ${invoice.total_usdc} USDC.`);
      } else {
        setErrorMsg(e.message || "Failed to check balance");
      }
      setPayStatus('error');
      return;
    }

    try {
      // 2. Initiate transfer
      const { data } = await api.post('/payments/initiate', {
        recipient_wallet: invoice.creator?.wallet_address,
        sender_pubkey: publicKey.toString(),
        amount_usdc: invoice.total_usdc,
        memo: `Invoice ${invoice.invoice_number}`,
        use_escrow: false,
      });

      // 3. Sign & Send
      setPayStatus('signing');
      const tx = Transaction.from(Buffer.from(data.transaction, 'base64'));
      const sig = await sendTransaction(tx, connection);

      // 4. Confirm
      setPayStatus('confirming');
      await connection.confirmTransaction(sig, 'confirmed');

      // 5. Mark invoice paid
      await payInvoice(invoice.id, publicKey.toString(), sig);
      
      setTxSig(sig);
      setPayStatus('done');
      
      // Reload invoice state
      await loadInvoice();
    } catch (err: any) {
      console.error('Payment error:', err);
      if (err?.message?.includes("User rejected")) {
        setErrorMsg("User denied transaction signature.");
      } else {
        setErrorMsg(err?.message || "Transaction failed");
      }
      setPayStatus('error');
    }
  }

  async function handleAddComment() {
    if (!invoice || !newComment.trim()) return;
    
    setIsSubmittingComment(true);
    try {
      const isCreator = connected && publicKey?.toBase58() === invoice.creator?.wallet_address;
      
      await addInvoiceComment(invoice.id, {
        author_role: isCreator ? 'creator' : 'payer',
        author_name: isCreator ? invoice.creator?.display_name : (invoice.payer_name || 'Payer'),
        author_wallet: connected ? publicKey?.toBase58() : undefined,
        body: newComment
      });
      
      setNewComment('');
      const comms = await fetchInvoiceComments(invoice.id);
      setComments(comms);
    } catch (err) {
      console.error('Failed to post comment', err);
    } finally {
      setIsSubmittingComment(false);
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#00C896]" size={48} />
      </main>
    );
  }

  if (error || !invoice) {
    return (
      <main className="min-h-screen bg-[#0A0F1E] flex flex-col items-center justify-center p-4">
        <BrandLogo className="mb-8" />
        <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-8 text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-2">Invoice Not Found</h1>
          <p className="text-[#8896B3]">{error}</p>
        </div>
      </main>
    );
  }

  const isCreator = connected && publicKey?.toBase58() === invoice.creator?.wallet_address;
  const canPay = (invoice.status === 'sent' || invoice.status === 'viewed') && !isCreator;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#112B4A_0%,_#0A0F1E_45%,_#050814_100%)] px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
        <div className="mb-8 flex justify-center sm:justify-start">
          <BrandLogo />
        </div>

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start">
          
          {/* ── Left Col: Invoice Details ────────────────────────────────────── */}
          <section className="rounded-[32px] border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-8 mb-8">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="font-[Space_Grotesk] text-3xl font-bold text-white">
                    {invoice.title}
                  </h1>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${
                    invoice.status === 'paid' ? 'bg-[#00C896]/10 text-[#00C896]' :
                    invoice.status === 'cancelled' ? 'bg-[#FF5F82]/10 text-[#FF5F82]' :
                    'bg-[#EAB308]/10 text-[#EAB308]'
                  }`}>
                    {invoice.status}
                  </span>
                </div>
                <p className="text-sm font-mono text-[#8896B3]">Invoice #{invoice.invoice_number}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-widest text-[#7BF0C9] mb-1">Total Due</p>
                <p className="text-4xl font-bold text-[#00C896]">${invoice.total_usdc} <span className="text-lg text-[#8896B3]">USDC</span></p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs uppercase tracking-widest text-[#4E638A] mb-3">From</p>
                {invoice.creator && (
                  <div className="flex items-center gap-3">
                    <UserAvatar name={invoice.creator.display_name} className="h-10 w-10 text-xs" />
                    <div>
                      <p className="text-sm font-bold text-white">{invoice.creator.display_name}</p>
                      <p className="text-xs text-[#8896B3]">{shortenAddress(invoice.creator.wallet_address)}</p>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-[#4E638A] mb-3">Billed To</p>
                {(invoice.payer_name || invoice.payer_email) ? (
                  <div>
                    {invoice.payer_name && <p className="text-sm font-bold text-white">{invoice.payer_name}</p>}
                    {invoice.payer_email && <p className="text-xs text-[#8896B3]">{invoice.payer_email}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-[#8896B3] italic">No payer details provided</p>
                )}
              </div>
            </div>

            {invoice.description && (
              <div className="mb-8 text-sm text-[#D6DEEE] bg-black/20 p-4 rounded-2xl">
                {invoice.description}
              </div>
            )}

            <div className="mb-8">
              <h3 className="text-lg font-bold text-white mb-4">Line Items</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[#8896B3]">
                      <th className="pb-3 font-medium">Description</th>
                      <th className="pb-3 font-medium text-right">Qty</th>
                      <th className="pb-3 font-medium text-right">Price</th>
                      <th className="pb-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#D6DEEE]">
                    {invoice.items.map((item) => (
                      <tr key={item.id} className="border-b border-white/5">
                        <td className="py-4">{item.description}</td>
                        <td className="py-4 text-right">{item.quantity}</td>
                        <td className="py-4 text-right">${item.unit_price}</td>
                        <td className="py-4 text-right font-bold">${item.amount_usdc}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="pt-6 pb-2 text-right font-bold text-[#8896B3]">Total Amount</td>
                      <td className="pt-6 pb-2 text-right font-bold text-xl text-white">${invoice.total_usdc} USDC</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

          </section>

          {/* ── Right Col: Payment & Comments ──────────────────────────────── */}
          <div className="flex flex-col gap-6">
            
            {/* Payment Section */}
            <div className="rounded-[32px] border border-[#1A2235] bg-[#0D1B35] p-6 shadow-2xl">
              {invoice.status === 'paid' ? (
                <div className="text-center p-6">
                  <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-[#00C896]/10 flex items-center justify-center text-[#00C896]">
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">Invoice Paid</h3>
                  <p className="text-sm text-[#8896B3] mb-4">
                    Paid on {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : 'recently'}
                  </p>
                  {invoice.tx_signature && (
                    <a
                      href={`https://solscan.io/tx/${invoice.tx_signature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-[#00C896] hover:underline"
                    >
                      View Receipt on Solscan <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              ) : invoice.status === 'cancelled' ? (
                <div className="text-center p-6 text-[#FF5F82]">
                  <h3 className="text-xl font-bold mb-2">Invoice Cancelled</h3>
                  <p className="text-sm opacity-80">This invoice is no longer valid.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="mb-2">
                    <h2 className="text-xl font-bold text-white text-center">Payment</h2>
                  </div>

                  {payStatus === 'error' && errorMsg && (
                    <div className="rounded-xl border border-[#FF5F82]/30 bg-[#FF5F82]/10 p-4 text-center text-[#FF5F82] text-sm break-words">
                      <AlertCircle className="inline-block mr-1 mb-0.5" size={16} />
                      {errorMsg}
                      <button onClick={() => setPayStatus('idle')} className="block mx-auto mt-2 text-xs underline hover:text-white transition-colors">
                        Try again
                      </button>
                    </div>
                  )}
                  
                  {!connected ? (
                    <WalletConnectButton className="!h-14 !w-full !rounded-2xl !bg-[#00C896] !font-bold !text-[#0A0F1E] !text-lg" />
                  ) : isCreator ? (
                    <div className="rounded-xl border border-[#00C896]/30 bg-[#00C896]/10 p-4 text-center text-[#00C896] text-sm">
                      <ShieldCheck className="mx-auto mb-2" size={24} />
                      You are the creator. Share this link to get paid.
                    </div>
                  ) : (
                    <button
                      onClick={handlePay}
                      disabled={payStatus !== 'idle' && payStatus !== 'error'}
                      className="w-full bg-[#00C896] text-[#0A0F1E] font-bold py-4
                                 rounded-2xl text-lg hover:bg-[#00B085] transition-colors
                                 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {payStatus === 'idle' ? `Pay $${invoice.total_usdc} USDC` :
                       payStatus === 'building' ? 'Preparing...' :
                       payStatus === 'signing' ? 'Confirm in Wallet...' :
                       payStatus === 'confirming' ? 'Confirming on-chain...' :
                       payStatus === 'done' ? '✅ Paid!' :
                       '❌ Payment Failed - Try Again'}
                    </button>
                  )}
                  <p className="text-center text-xs text-[#4E638A] flex items-center justify-center gap-1 mt-2">
                    <ShieldCheck size={12} /> Secure Solana Transfer
                  </p>
                </div>
              )}
            </div>

            {/* Comments Section */}
            <div className="rounded-[32px] border border-[#1A2235] bg-[#0D1B35] p-6 shadow-2xl flex flex-col h-[400px]">
              <div className="flex items-center gap-2 mb-4 text-white">
                <MessageSquare size={18} />
                <h3 className="font-bold">Discussion / Reviews</h3>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-4 mb-4">
                {comments.length === 0 ? (
                  <div className="text-center text-sm text-[#4E638A] pt-10">
                    No comments yet. Leave a review or question below.
                  </div>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className={`flex flex-col gap-1 ${comment.author_role === 'creator' ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 text-[10px] text-[#8896B3]">
                        <span className="font-bold">{comment.author_name || (comment.author_role === 'creator' ? 'Creator' : 'Payer')}</span>
                        {comment.author_role === 'creator' && <span className="bg-[#00C896]/20 text-[#00C896] px-1.5 rounded uppercase">Creator</span>}
                      </div>
                      <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${
                        comment.author_role === 'creator' 
                          ? 'bg-[#00C896]/10 text-[#00C896] rounded-tr-sm border border-[#00C896]/20' 
                          : 'bg-[#1A2235] text-white rounded-tl-sm'
                      }`}>
                        {comment.body}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Comment */}
              <div className="relative mt-auto">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment or review..."
                  className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] pl-4 pr-12 py-3 text-sm text-white outline-none focus:border-[#00C896] transition-colors resize-none"
                  rows={2}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || isSubmittingComment}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-[#1A2235] p-2 text-[#8896B3] hover:text-[#00C896] hover:bg-[#2C3B5E] disabled:opacity-50 transition-colors"
                >
                  {isSubmittingComment ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>

          </div>
        </div>

        <p className="pb-4 pt-12 text-center text-xs text-[#8896B3]">
          Powered by{' '}
          <a href="/" className="text-[#00C896] hover:underline font-bold">
            PayLink
          </a>
        </p>
      </div>
    </main>
  );
}
