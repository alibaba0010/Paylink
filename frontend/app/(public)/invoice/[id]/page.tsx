'use client';

import { use, useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BrandLogo } from '@/components/BrandLogo';
import { UserAvatar } from '@/components/UserAvatar';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import {
  fetchInvoice,
  fetchInvoiceComments,
  addInvoiceComment,
  payInvoice,
  updateInvoice as apiUpdateInvoice,
  api,
  type Invoice,
  type InvoiceComment
} from '@/lib/api';
import { shortenAddress } from '@/lib/format';
import {
  confirmSignatureWithStatus,
  DEVNET_USDC_MINT,
  getUsdcBalanceRaw,
  waitForRecipientUsdcCredit,
} from '@/lib/solana-payments';
import { Loader2, CheckCircle2, MessageSquare, Send, ExternalLink, ShieldCheck, AlertCircle, Edit2, Save, X, Plus, Trash2 } from 'lucide-react';

export default function PublicInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPayerName, setEditPayerName] = useState('');
  const [editPayerEmail, setEditPayerEmail] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editItems, setEditItems] = useState<{ description: string; quantity: number; unit_price: number }[]>([]);
  const [isSaving, setIsSaving] = useState(false);

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
        
        // Initialize edit state
        setEditTitle(inv.title);
        setEditDescription(inv.description || '');
        setEditPayerName(inv.payer_name || '');
        setEditPayerEmail(inv.payer_email || '');
        setEditDueDate(inv.due_date || '');
        setEditItems(inv.items.map(it => ({
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price
        })));
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invoice not found');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!invoice || !publicKey) return;
    setIsSaving(true);
    try {
      const updated = await apiUpdateInvoice(invoice.id, {
        creator_wallet: publicKey.toBase58(),
        title: editTitle,
        description: editDescription,
        payer_name: editPayerName,
        payer_email: editPayerEmail,
        due_date: editDueDate || undefined,
        items: editItems
      });
      setInvoice(updated);
      setIsEditing(false);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || 'Failed to update invoice');
    } finally {
      setIsSaving(false);
    }
  }

  const editTotal = editItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

  async function handlePay() {
    if (!invoice || !connected || !publicKey) return;
    
    setPayStatus('building');
    setErrorMsg('');

    try {
      // 1. Check user balance first
      const senderATA = await getAssociatedTokenAddress(DEVNET_USDC_MINT, publicKey);
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
      const recipientWallet = invoice.creator?.wallet_address;
      if (!recipientWallet) {
        throw new Error('Invoice recipient wallet is missing');
      }

      const recipientStartingBalance = await getUsdcBalanceRaw(
        connection,
        new PublicKey(recipientWallet),
      );

      // 2. Initiate transfer
      const { data } = await api.post('/payments/initiate', {
        recipient_wallet: recipientWallet,
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
      await confirmSignatureWithStatus(connection, sig);
      await waitForRecipientUsdcCredit(
        connection,
        recipientWallet,
        invoice.total_usdc,
        recipientStartingBalance,
      );

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#112B4A_0%,_#0A0F1E_45%,_#050814_100%)] px-4 py-12 sm:px-6">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col">
        <div className="mb-12 flex items-center justify-between">
          <BrandLogo className="scale-110 origin-left" />
          {!connected && <WalletConnectButton className="!rounded-2xl !bg-white/5 !border !border-white/10 !text-white hover:!bg-white/10 transition-all !px-6" />}
        </div>

        <div className="grid flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          
          {/* ── Left Col: Invoice Details ────────────────────────────────────── */}
          <section className="rounded-[40px] border border-white/10 bg-white/[0.02] p-6 backdrop-blur-2xl sm:p-12 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#00C896]/5 blur-[100px] rounded-full -mr-32 -mt-32 pointer-events-none group-hover:bg-[#00C896]/10 transition-all duration-700" />
            
            {isEditing ? (
              <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-white/5 pb-8">
                  <div className="flex-1">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4E638A] mb-2 block">Invoice Title</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-white text-2xl font-bold outline-none focus:border-[#00C896] focus:bg-white/[0.05] transition-all shadow-inner"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setIsEditing(false)} className="h-14 px-6 rounded-2xl border border-white/10 text-white hover:bg-white/5 transition-all active:scale-95 flex items-center gap-2">
                      <X size={20} />
                      <span className="font-bold">Cancel</span>
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                      className="h-14 px-8 rounded-2xl bg-gradient-to-r from-[#00C896] to-[#00E5AC] text-[#0A0F1E] font-black hover:shadow-[0_0_30px_rgba(0,200,150,0.4)] transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                      Save Changes
                    </button>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-10">
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#4E638A] font-black">Billed To (Name)</p>
                    <input
                      type="text"
                      value={editPayerName}
                      onChange={e => setEditPayerName(e.target.value)}
                      placeholder="Client Name"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-3.5 text-white outline-none focus:border-[#00C896] transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#4E638A] font-black">Billed To (Email)</p>
                    <input
                      type="email"
                      value={editPayerEmail}
                      onChange={e => setEditPayerEmail(e.target.value)}
                      placeholder="client@example.com"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-3.5 text-white outline-none focus:border-[#00C896] transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#4E638A] font-black">Description / Terms</p>
                  <textarea
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    rows={4}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-sm text-white/80 outline-none focus:border-[#00C896] transition-all resize-none leading-relaxed"
                    placeholder="Project details, payment terms, etc."
                  />
                </div>

                <div className="pt-4">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-3">
                      <div className="w-1.5 h-6 bg-[#00C896] rounded-full" />
                      Line Items
                    </h3>
                    <div className="text-right">
                       <span className="text-xs text-[#4E638A] mr-3 font-bold uppercase tracking-widest">Subtotal</span>
                       <span className="text-2xl font-black text-[#00C896]">${editTotal.toLocaleString()} USDC</span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {editItems.map((item, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row gap-4 bg-white/[0.02] p-5 rounded-3xl border border-white/5 hover:border-white/10 transition-all group/item">
                        <div className="flex-1">
                          <input
                            type="text"
                            value={item.description}
                            onChange={e => {
                              const newItems = [...editItems];
                              newItems[idx].description = e.target.value;
                              setEditItems(newItems);
                            }}
                            placeholder="Item description"
                            className="w-full bg-transparent border-none text-base text-white outline-none placeholder:text-white/10 font-medium"
                          />
                        </div>
                        <div className="flex gap-4 items-center">
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] uppercase tracking-tighter text-[#4E638A] mb-1 font-bold">Qty</span>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={e => {
                                const newItems = [...editItems];
                                newItems[idx].quantity = Number(e.target.value);
                                setEditItems(newItems);
                              }}
                              className="w-16 bg-white/5 rounded-xl px-2 py-2 text-center text-sm text-white outline-none border border-white/10 focus:border-[#00C896]"
                            />
                          </div>
                          <span className="text-white/10 text-xs mt-4">×</span>
                          <div className="flex flex-col items-end">
                            <span className="text-[8px] uppercase tracking-tighter text-[#4E638A] mb-1 font-bold">Price</span>
                            <input
                              type="number"
                              value={item.unit_price}
                              onChange={e => {
                                const newItems = [...editItems];
                                newItems[idx].unit_price = Number(e.target.value);
                                setEditItems(newItems);
                              }}
                              className="w-28 bg-white/5 rounded-xl px-3 py-2 text-right text-sm text-[#00C896] font-bold outline-none border border-white/10 focus:border-[#00C896]"
                            />
                          </div>
                          <button
                            onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))}
                            className="p-2.5 text-white/10 hover:text-[#FF5F82] hover:bg-[#FF5F82]/10 rounded-xl transition-all mt-4"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setEditItems([...editItems, { description: '', quantity: 1, unit_price: 0 }])}
                      className="w-full py-5 rounded-3xl border border-dashed border-white/10 text-[#8896B3] hover:border-[#00C896] hover:text-[#00C896] hover:bg-[#00C896]/5 transition-all flex items-center justify-center gap-3 text-sm font-black uppercase tracking-widest"
                    >
                      <Plus size={20} /> Add New Item
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative z-10 animate-in fade-in duration-700">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-8 border-b border-white/5 pb-10 mb-10">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-4 mb-4">
                      <span className={`rounded-xl px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] shadow-lg ${
                        invoice.status === 'paid' ? 'bg-[#00C896] text-[#0A0F1E]' :
                        invoice.status === 'cancelled' ? 'bg-[#FF5F82] text-white' :
                        invoice.status === 'viewed' ? 'bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30' :
                        'bg-[#EAB308]/20 text-[#EAB308] border border-[#EAB308]/30'
                      }`}>
                        {invoice.status}
                      </span>
                      <p className="text-xs font-mono text-[#4E638A] uppercase tracking-widest">ID: {invoice.invoice_number}</p>
                    </div>
                    <h1 className="font-[Space_Grotesk] text-4xl sm:text-5xl font-black text-white leading-tight mb-4">
                      {invoice.title}
                    </h1>
                    {isCreator && invoice.status !== 'paid' && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#00C896] hover:text-[#00E5AC] transition-all bg-[#00C896]/5 px-5 py-3 rounded-2xl border border-[#00C896]/20 hover:border-[#00C896]/40 hover:shadow-[0_0_20px_rgba(0,200,150,0.1)] group/btn"
                      >
                        <Edit2 size={14} className="group-hover/btn:rotate-12 transition-transform" /> Edit Invoice
                      </button>
                    )}
                  </div>
                  <div className="text-left sm:text-right bg-white/[0.03] p-6 rounded-[32px] border border-white/5 min-w-[200px]">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00C896] mb-2 opacity-70">Total Amount Due</p>
                    <p className="text-5xl font-black text-white leading-none">
                      <span className="text-2xl text-[#00C896] mr-1">$</span>
                      {invoice.total_usdc.toLocaleString()}
                    </p>
                    <p className="text-xs font-bold text-[#4E638A] mt-2 uppercase tracking-widest">USDC (Solana)</p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-12 mb-12">
                  <div className="group/card">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4E638A] mb-4">Issuer Information</p>
                    {invoice.creator && (
                      <div className="flex items-center gap-4 bg-white/[0.03] p-5 rounded-3xl border border-white/5 group-hover/card:border-[#00C896]/30 transition-all duration-500">
                        <UserAvatar name={invoice.creator.display_name} className="h-14 w-14 text-lg ring-4 ring-white/5" />
                        <div>
                          <p className="text-lg font-black text-white">{invoice.creator.display_name}</p>
                          <p className="text-xs font-mono text-[#8896B3]">{shortenAddress(invoice.creator.wallet_address)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="group/card">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4E638A] mb-4">Billed To</p>
                    <div className="bg-white/[0.03] p-5 rounded-3xl border border-white/5 group-hover/card:border-[#3B82F6]/30 transition-all duration-500 min-h-[82px] flex flex-col justify-center">
                      {(invoice.payer_name || invoice.payer_email) ? (
                        <>
                          {invoice.payer_name && <p className="text-lg font-black text-white">{invoice.payer_name}</p>}
                          {invoice.payer_email && <p className="text-xs font-medium text-[#8896B3]">{invoice.payer_email}</p>}
                        </>
                      ) : (
                        <p className="text-sm text-[#4E638A] italic">No specific payer details provided</p>
                      )}
                    </div>
                  </div>
                </div>

                {invoice.description && (
                  <div className="mb-12 relative">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4E638A] mb-4">Terms & Details</p>
                    <div className="text-sm text-white/70 bg-white/[0.02] p-6 rounded-3xl border border-white/5 leading-relaxed italic">
                      "{invoice.description}"
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                    <div className="w-1.5 h-6 bg-[#00C896] rounded-full" />
                    Billable Items
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-[#4E638A]">
                          <th className="pb-4 pl-2">Description</th>
                          <th className="pb-4 text-right">Quantity</th>
                          <th className="pb-4 text-right">Unit Price</th>
                          <th className="pb-4 text-right pr-2">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="text-white/80">
                        {invoice.items.map((item) => (
                          <tr key={item.id} className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors group/row">
                            <td className="py-6 pl-2 font-medium group-hover/row:text-white transition-colors">{item.description}</td>
                            <td className="py-6 text-right font-mono text-sm">{item.quantity}</td>
                            <td className="py-6 text-right font-mono text-sm">${item.unit_price.toLocaleString()}</td>
                            <td className="py-6 text-right font-black text-[#00C896] pr-2">${item.amount_usdc.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} className="pt-10 pb-2 text-right font-black uppercase tracking-[0.2em] text-[#4E638A] text-xs">Total Amount</td>
                          <td className="pt-10 pb-2 text-right font-black text-3xl text-[#00C896] pr-2 underline underline-offset-8 decoration-white/10">${invoice.total_usdc.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── Right Col: Payment & Comments ──────────────────────────────── */}
          <div className="flex flex-col gap-8">
            
            {/* Payment Section */}
            <div className="rounded-[40px] border border-white/10 bg-[#0D1B35]/80 backdrop-blur-xl p-8 shadow-2xl relative overflow-hidden group/pay">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#00C896]/5 blur-3xl rounded-full -mr-16 -mt-16" />
              
              {invoice.status === 'paid' ? (
                <div className="text-center py-4 relative z-10">
                  <div className="mx-auto mb-6 h-20 w-20 rounded-full bg-[#00C896]/10 flex items-center justify-center text-[#00C896] shadow-[0_0_40px_rgba(0,200,150,0.2)]">
                    <CheckCircle2 size={48} />
                  </div>
                  <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-tight">Payment Received</h3>
                  <p className="text-sm text-[#8896B3] mb-6">
                    Processed on {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'recently'}
                  </p>
                  {invoice.tx_signature && (
                    <a
                      href={`https://solscan.io/tx/${invoice.tx_signature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#00C896] hover:text-[#00E5AC] transition-all bg-[#00C896]/10 px-6 py-3 rounded-2xl border border-[#00C896]/20"
                    >
                      Inspect on Explorer <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              ) : invoice.status === 'cancelled' ? (
                <div className="text-center py-6 text-[#FF5F82] relative z-10">
                  <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-[#FF5F82]/10 flex items-center justify-center">
                    <X size={32} />
                  </div>
                  <h3 className="text-xl font-black mb-2 uppercase">Invoice Void</h3>
                  <p className="text-sm opacity-80">This billing record has been cancelled by the issuer.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-6 relative z-10">
                  <div className="text-center">
                    <h2 className="text-xs font-black text-[#4E638A] uppercase tracking-[0.3em] mb-1">Settlement</h2>
                    <p className="text-2xl font-black text-white">Execute Payment</p>
                  </div>

                  {payStatus === 'error' && errorMsg && (
                    <div className="rounded-2xl border border-[#FF5F82]/30 bg-[#FF5F82]/10 p-5 text-center text-[#FF5F82] text-xs leading-relaxed animate-in zoom-in-95 duration-300">
                      <AlertCircle className="inline-block mr-2 mb-0.5" size={16} />
                      {errorMsg}
                      <button onClick={() => setPayStatus('idle')} className="block mx-auto mt-3 font-black uppercase tracking-widest text-[10px] underline hover:text-white transition-colors">
                        Re-attempt
                      </button>
                    </div>
                  )}
                  
                  {!connected ? (
                    <div className="flex flex-col gap-4">
                      <p className="text-center text-xs text-[#8896B3] px-4">Connect your Solana wallet to settle this invoice using USDC.</p>
                      <WalletConnectButton className="!h-16 !w-full !rounded-[24px] !bg-gradient-to-r !from-[#00C896] !to-[#00E5AC] !font-black !text-[#0A0F1E] !text-lg !shadow-xl !border-0 hover:!scale-[1.02] active:!scale-95 transition-all" />
                    </div>
                  ) : isCreator ? (
                    <div className="rounded-3xl border border-[#00C896]/20 bg-[#00C896]/5 p-6 text-center text-[#00C896]">
                      <ShieldCheck className="mx-auto mb-3" size={32} />
                      <p className="text-xs font-bold leading-relaxed">
                        You are viewing your own invoice. Share the public URL with your client to receive payment.
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={handlePay}
                      disabled={payStatus !== 'idle' && payStatus !== 'error'}
                      className="w-full bg-gradient-to-r from-[#00C896] to-[#00E5AC] text-[#0A0F1E] font-black py-5
                                 rounded-[24px] text-lg hover:shadow-[0_20px_40px_-10px_rgba(0,200,150,0.4)] transition-all
                                 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed group/paybtn overflow-hidden relative"
                    >
                      <span className="relative z-10 flex items-center justify-center gap-3">
                        {payStatus === 'idle' ? `Settle $${invoice.total_usdc.toLocaleString()} USDC` :
                         payStatus === 'building' ? 'Validating...' :
                         payStatus === 'signing' ? 'Awaiting Signature...' :
                         payStatus === 'confirming' ? 'Finalizing...' :
                         payStatus === 'done' ? 'Success!' :
                         'Retry Payment'}
                        {payStatus !== 'idle' && payStatus !== 'done' && <Loader2 size={20} className="animate-spin" />}
                      </span>
                    </button>
                  )}
                  <div className="flex flex-col items-center gap-4 border-t border-white/5 pt-6">
                    <p className="text-[10px] font-black text-[#4E638A] uppercase tracking-[0.2em] flex items-center gap-2">
                      <ShieldCheck size={14} className="text-[#00C896]" /> Verified Solana Transaction
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Comments Section */}
            <div className="rounded-[40px] border border-white/10 bg-[#0D1B35]/50 backdrop-blur-xl p-8 shadow-2xl flex flex-col h-[450px] group/comments">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3 text-white">
                  <MessageSquare size={20} className="text-[#3B82F6]" />
                  <h3 className="font-black uppercase tracking-widest text-xs">Activity Log</h3>
                </div>
                <span className="text-[10px] font-black text-[#4E638A] uppercase bg-white/5 px-3 py-1 rounded-full">
                  {comments.length} Messages
                </span>
              </div>

              <div className="flex-1 overflow-y-auto pr-3 space-y-6 mb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {comments.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4 text-[#4E638A]">
                      <MessageSquare size={24} />
                    </div>
                    <p className="text-xs text-[#4E638A] font-bold uppercase tracking-widest px-8 leading-relaxed">
                      No discussion history yet for this invoice.
                    </p>
                  </div>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className={`flex flex-col gap-2 ${comment.author_role === 'creator' ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[#4E638A]">
                        {comment.author_role === 'creator' && <span className="text-[#00C896] bg-[#00C896]/10 px-2 py-0.5 rounded">Owner</span>}
                        <span>{comment.author_name || (comment.author_role === 'creator' ? 'Creator' : 'Payer')}</span>
                      </div>
                      <div className={`max-w-[90%] rounded-3xl px-5 py-4 text-sm leading-relaxed shadow-lg transition-all ${
                        comment.author_role === 'creator' 
                          ? 'bg-gradient-to-br from-[#00C896]/20 to-[#00C896]/5 text-[#00C896] rounded-tr-none border border-[#00C896]/20' 
                          : 'bg-white/[0.03] text-white/90 rounded-tl-none border border-white/5'
                      }`}>
                        {comment.body}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Comment */}
              <div className="relative mt-auto pt-4 border-t border-white/5">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Type a message or review..."
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.02] pl-5 pr-14 py-4 text-sm text-white outline-none focus:border-[#3B82F6] focus:bg-white/[0.05] transition-all resize-none leading-relaxed placeholder:text-white/10"
                  rows={2}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || isSubmittingComment}
                  className="absolute right-3 top-[calc(50%+8px)] -translate-y-1/2 rounded-xl bg-[#3B82F6] p-2.5 text-white shadow-lg hover:shadow-[#3B82F6]/30 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all"
                >
                  {isSubmittingComment ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
            </div>

          </div>
        </div>

        <p className="pb-12 pt-20 text-center text-[10px] font-black uppercase tracking-[0.4em] text-[#4E638A]">
          Secured by{' '}
          <a href="/" className="text-[#00C896] hover:text-white transition-colors">
            PayLink Protocol
          </a>
        </p>
      </div>
    </main>
  );

}
