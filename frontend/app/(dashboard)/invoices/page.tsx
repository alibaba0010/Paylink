'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { 
  Plus, Copy, QrCode, Eye, Wallet, 
  ChevronRight, ArrowLeft, Info, 
  Loader2, BadgeCheck, Zap, FileText, CheckCircle2,
  Trash2
} from 'lucide-react';
import { 
  fetchInvoices,
  createInvoice,
  cancelInvoice,
  type Invoice,
  type InvoiceItem
} from '@/lib/api';
import { CopyValueButton } from '@/components/CopyValueButton';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { shortenAddress } from '@/lib/format';

type ViewState = 'list' | 'create';

export default function InvoicesPage() {
  const { publicKey, connected } = useWallet();
  const [view, setView] = useState<ViewState>('list');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  
  // Create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<{ description: string; quantity: number; unit_price: number }[]>([
    { description: '', quantity: 1, unit_price: 0 }
  ]);

  const [showQR, setShowQR] = useState<string | null>(null);

  useEffect(() => {
    if (connected && publicKey) {
      loadInvoices();
    } else {
      setIsLoading(false);
    }
  }, [connected, publicKey]);

  async function loadInvoices() {
    if (!publicKey) return;
    setIsLoading(true);
    try {
      const data = await fetchInvoices(publicKey.toBase58());
      setInvoices(data);
    } catch (err) {
      console.error('Failed to load invoices:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const handleAddItem = () => {
    setItems([...items, { description: '', quantity: 1, unit_price: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const handleItemChange = (index: number, field: string, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

  async function handleCreate() {
    if (!publicKey || !title || items.length === 0) return;
    setIsCreating(true);
    try {
      await createInvoice({
        creator_wallet: publicKey.toBase58(),
        title,
        description,
        payer_name: payerName,
        payer_email: payerEmail,
        due_date: dueDate || undefined,
        items
      });
      await loadInvoices();
      setView('list');
      // Reset form
      setTitle('');
      setDescription('');
      setPayerName('');
      setPayerEmail('');
      setDueDate('');
      setItems([{ description: '', quantity: 1, unit_price: 0 }]);
    } catch (err) {
      console.error('Failed to create invoice:', err);
      alert('Failed to create invoice');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCancel(id: string) {
    if (!publicKey || !confirm('Are you sure you want to cancel this invoice?')) return;
    try {
      await cancelInvoice(id, publicKey.toBase58());
      await loadInvoices();
    } catch (err) {
      console.error('Failed to cancel invoice:', err);
    }
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  if (!connected) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-[#0D1B35] p-6 text-[#4E638A]">
          <Wallet size={48} />
        </div>
        <h2 className="text-2xl font-bold text-white">Connect your wallet</h2>
        <p className="max-w-xs text-[#8896B3]">
          You need to connect your wallet to manage and create invoices.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">
          {view === 'list' ? 'Invoices' : 'Create Invoice'}
        </h1>
        {view !== 'list' && (
          <button 
            onClick={() => setView('list')}
            className="flex items-center gap-2 text-sm text-[#8896B3] hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        )}
      </div>

      {/* ── List View ─────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="flex flex-col gap-8">
          <button 
            onClick={() => setView('create')}
            className="w-fit flex items-center gap-2 rounded-xl bg-[#00C896] px-5 py-3 text-sm font-bold text-[#0A0F1E] hover:bg-[#00E5AC] transition-colors"
          >
            <Plus size={16} /> Create New Invoice
          </button>

          {isLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="animate-spin text-[#00C896]" size={32} />
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-[28px] border border-[#1A2235] bg-[#0D1B35]/30 p-12 text-center text-[#8896B3]">
              No invoices found. Create one to get started!
            </div>
          ) : (
            <div className="grid gap-6">
              {invoices.map((inv) => {
                const fullUrl = `${appUrl}/invoice/${inv.invoice_number}`;
                const displayUrl = `paylink.me/invoice/${inv.invoice_number}`;
                
                return (
                  <div 
                    key={inv.id}
                    className="flex flex-col md:flex-row md:items-center justify-between gap-5 rounded-[24px] border border-[#1A2235] bg-[#0D1B35] p-6 transition-all hover:border-white/20"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-bold text-white">{inv.title}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
                          inv.status === 'paid' ? 'bg-[#00C896]/10 text-[#00C896]' :
                          inv.status === 'cancelled' ? 'bg-[#FF5F82]/10 text-[#FF5F82]' :
                          inv.status === 'viewed' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-[#EAB308]/10 text-[#EAB308]'
                        }`}>
                          {inv.status}
                        </span>
                      </div>
                      <div className="text-sm text-[#8896B3]">
                        {inv.invoice_number} • {new Date(inv.created_at).toLocaleDateString()}
                        {inv.payer_name && ` • To: ${inv.payer_name}`}
                      </div>
                      <div className="text-lg font-bold text-[#00C896]">
                        ${inv.total_usdc} USDC
                      </div>
                    </div>

                    <div className="flex flex-col md:items-end gap-3">
                      {inv.status === 'paid' && inv.paid_by_wallet && (
                        <div className="text-sm text-[#8896B3]">
                          Paid by {shortenAddress(inv.paid_by_wallet)}
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2 rounded-xl bg-[#081122] p-2 pl-4 border border-[#1A2235]">
                        <span className="truncate text-xs font-mono text-[#D6DEEE]">
                          {displayUrl}
                        </span>
                        <div className="flex items-center gap-1">
                          <CopyValueButton 
                            value={fullUrl} 
                            title="Copy Link"
                            className="h-8 w-8 border-transparent bg-[#1A2235] hover:bg-[#2C3B5E] text-[#8896B3] hover:text-[#00C896]" 
                          />
                          <button 
                            onClick={() => setShowQR(fullUrl)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1A2235] text-[#8896B3] transition-colors hover:bg-[#2C3B5E] hover:text-[#00C896]"
                          >
                            <QrCode size={14} />
                          </button>
                        </div>
                      </div>

                      {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                        <button 
                          onClick={() => handleCancel(inv.id)}
                          className="text-xs text-[#FF5F82] hover:underline"
                        >
                          Cancel Invoice
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Create Invoice View ───────────────────────────────── */}
      {view === 'create' && (
        <div className="mx-auto w-full max-w-3xl animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="rounded-[32px] border border-[#1A2235] bg-[#0D1B35] p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-6">Create New Invoice</h2>
            
            <div className="flex flex-col gap-8">
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">Invoice Title *</label>
                  <input 
                    type="text" 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Web Design Services"
                    className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-3 text-white outline-none focus:border-[#00C896] transition-colors"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">Description</label>
                  <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional details..."
                    rows={2}
                    className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-3 text-white outline-none focus:border-[#00C896] transition-colors resize-none"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white">Payer Name (Optional)</label>
                    <input 
                      type="text" 
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                      placeholder="Client Name"
                      className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-3 text-white outline-none focus:border-[#00C896] transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white">Payer Email (Optional)</label>
                    <input 
                      type="email" 
                      value={payerEmail}
                      onChange={(e) => setPayerEmail(e.target.value)}
                      placeholder="client@example.com"
                      className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-3 text-white outline-none focus:border-[#00C896] transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <h3 className="text-lg font-bold text-white mb-4">Line Items *</h3>
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div key={index} className="flex gap-3 items-start">
                      <div className="flex-1">
                        <input 
                          type="text" 
                          value={item.description}
                          onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                          placeholder="Item description"
                          className="w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3 text-sm text-white outline-none focus:border-[#00C896] transition-colors"
                        />
                      </div>
                      <div className="w-24">
                        <input 
                          type="number" 
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                          placeholder="Qty"
                          className="w-full rounded-xl border border-[#1A2235] bg-[#081122] px-4 py-3 text-sm text-white outline-none focus:border-[#00C896] transition-colors"
                        />
                      </div>
                      <div className="w-32 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8896B3]">$</span>
                        <input 
                          type="number" 
                          min="0"
                          step="0.01"
                          value={item.unit_price || ''}
                          onChange={(e) => handleItemChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          placeholder="Price"
                          className="w-full rounded-xl border border-[#1A2235] bg-[#081122] pl-6 pr-3 py-3 text-sm text-white outline-none focus:border-[#00C896] transition-colors"
                        />
                      </div>
                      <button 
                        onClick={() => handleRemoveItem(index)}
                        disabled={items.length <= 1}
                        className="mt-1.5 p-2 text-[#4E638A] hover:text-[#FF5F82] disabled:opacity-50"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  
                  <button 
                    onClick={handleAddItem}
                    className="flex items-center gap-2 text-sm text-[#00C896] hover:text-[#00E5AC]"
                  >
                    <Plus size={16} /> Add Item
                  </button>
                </div>

                <div className="mt-6 flex justify-between items-center rounded-2xl bg-[#081122] p-5 border border-[#1A2235]">
                  <span className="text-white font-bold">Total Amount</span>
                  <span className="text-2xl font-bold text-[#00C896]">${totalAmount.toFixed(2)} USDC</span>
                </div>
              </div>

              <button 
                onClick={handleCreate}
                disabled={!title || items.length === 0 || isCreating || totalAmount <= 0}
                className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#00C896] py-5 text-lg font-bold text-[#0A0F1E] transition-all hover:bg-[#00B085] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {isCreating ? <Loader2 size={24} className="animate-spin" /> : <FileText size={20} />}
                {isCreating ? 'Creating Invoice...' : 'Create Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ─────────────────────────────────────────── */}
      {showQR && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-[32px] border border-[#1A2235] bg-[#0D1B35] p-8 text-center animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-6">Scan to Pay Invoice</h3>
            <div className="mx-auto mb-6 bg-white p-4 rounded-3xl inline-block shadow-xl">
              <QRCodeDisplay url={showQR} size={200} />
            </div>
            <p className="text-sm text-[#8896B3] mb-8 break-all font-mono">
              {showQR}
            </p>
            <button 
              onClick={() => setShowQR(null)}
              className="w-full rounded-2xl bg-[#1A2235] py-4 text-sm font-bold text-white hover:bg-[#2C3B5E] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
