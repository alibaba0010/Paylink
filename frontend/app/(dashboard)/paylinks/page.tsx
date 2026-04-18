'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { 
  Plus, Copy, QrCode, Eye, Wallet, 
  ChevronRight, ArrowLeft, Info, 
  Loader2, BadgeCheck, Zap,
  Gift, 
  Package,
  FileText
} from 'lucide-react';
import { 
  fetchPaymentLinks, 
  createPaymentLink, 
  archivePaymentLink, 
  type PaymentLink 
} from '@/lib/api';
import { IconAvatar, IconPicker, AVATAR_ICONS } from '@/components/IconPicker';
import { CopyValueButton } from '@/components/CopyValueButton';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';

type ViewState = 'list' | 'templates' | 'create-simple';

export default function PayLinksPage() {
  const { publicKey, connected } = useWallet();
  const [view, setView] = useState<ViewState>('list');
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  
  // Create form state
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [iconKey, setIconKey] = useState('zap');
  const [memo, setMemo] = useState('');

  const [showQR, setShowQR] = useState<string | null>(null);

  useEffect(() => {
    if (connected && publicKey) {
      loadLinks();
    } else {
      setIsLoading(false);
    }
  }, [connected, publicKey]);

  async function loadLinks() {
    if (!publicKey) return;
    setIsLoading(true);
    try {
      const data = await fetchPaymentLinks(publicKey.toBase58());
      setLinks(data);
    } catch (err) {
      console.error('Failed to load links:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate() {
    if (!publicKey || !title) return;
    setIsCreating(true);
    try {
      await createPaymentLink({
        owner_wallet: publicKey.toBase58(),
        title,
        icon_key: iconKey,
        amount_usdc: amount ? parseFloat(amount) : null,
        memo,
        link_type: 'simple'
      });
      await loadLinks();
      setView('list');
      // Reset form
      setTitle('');
      setAmount('');
      setIconKey('zap');
      setMemo('');
    } catch (err) {
      console.error('Failed to create link:', err);
    } finally {
      setIsCreating(false);
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
          You need to connect your wallet to manage and create payment links.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="font-[Space_Grotesk] text-3xl font-bold sm:text-4xl">
          {view === 'list' ? 'Links' : view === 'templates' ? 'Choose a Template' : 'Create Link'}
        </h1>
        {view !== 'list' && (
          <button 
            onClick={() => setView(view === 'create-simple' ? 'templates' : 'list')}
            className="flex items-center gap-2 text-sm text-[#8896B3] hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        )}
      </div>

      {/* ── List View ─────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="flex flex-col gap-12">
          {/* Grid of Links */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Create New Link Trigger */}
            <button 
              onClick={() => setView('templates')}
              className="flex flex-col items-center justify-center gap-4 rounded-[28px] border-2 border-dashed border-[#1A2235] bg-[#0D1B35]/30 p-10 transition-all hover:border-[#00C896]/50 hover:bg-[#0D1B35]/50 group h-full min-h-[220px]"
            >
              <div className="rounded-full bg-[#1A2235] p-4 text-[#8896B3] transition-colors group-hover:bg-[#00C896] group-hover:text-[#0A0F1E]">
                <Plus size={24} />
              </div>
              <span className="font-bold text-[#8896B3] group-hover:text-white">Create New Link</span>
            </button>

            {/* Existing Links */}
            {links.map((link) => {
              const fullUrl = `${appUrl}/l/${link.link_id}`;
              const displayUrl = `paylink.me/l/${link.link_id.slice(0, 10)}...`;
              
              return (
                <div 
                  key={link.id}
                  className="relative flex flex-col gap-5 rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 transition-all hover:border-white/20"
                >
                  <div className="flex items-start justify-between">
                    <IconAvatar iconKey={link.icon_key} size={20} className="h-12 w-12" />
                    <div className="flex flex-col items-end gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#00C896]/10 px-2.5 py-1 text-[10px] font-bold text-[#00C896]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#00C896] animate-pulse" />
                        Simple Payment
                      </span>
                      <div className="flex items-center gap-3 text-[#8896B3]">
                        <div className="flex items-center gap-1 text-[11px]">
                          <Eye size={12} /> {link.view_count}
                        </div>
                        <div className="flex items-center gap-1 text-[11px]">
                          <BadgeCheck size={12} /> {link.payment_count}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <h3 className="text-xl font-bold text-white truncate">{link.title}</h3>
                    {link.amount_usdc && (
                      <p className="text-sm font-medium text-[#00C896] mt-1">
                        Fixed: ${link.amount_usdc} USDC
                      </p>
                    )}
                  </div>

                  <div className="mt-auto flex items-center gap-2 rounded-2xl bg-[#081122] p-2 pl-4 border border-[#1A2235]">
                    <span className="flex-1 truncate text-xs font-mono text-[#D6DEEE]">
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
                </div>
              );
            })}
          </div>

          {/* Archived Links Section */}
          <button className="flex w-full items-center justify-between rounded-3xl border border-[#1A2235] bg-[#0D1B35]/50 p-6 transition-colors hover:bg-[#0D1B35]">
            <div className="flex items-center gap-5 text-left">
              <div className="rounded-2xl bg-[#1A2235] p-3 text-[#8896B3]">
                <Package size={24} />
              </div>
              <div>
                <h4 className="font-bold text-white">Show Archived Links</h4>
                <p className="text-sm text-[#8896B3]">View your archived payment links</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-[#4E638A]" />
          </button>
        </div>
      )}

      {/* ── Templates View ────────────────────────────────────────── */}
      {view === 'templates' && (
        <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-2xl font-bold text-white">Pick the perfect template</h2>
              <Info size={16} className="text-[#8896B3]" />
            </div>
            
            <div className="space-y-8">
              {/* Popular Section */}
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9] mb-4">Popular</p>
                <div className="space-y-4">
                  <button 
                    onClick={() => setView('create-simple')}
                    className="flex w-full items-center gap-5 rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 transition-all hover:border-[#00C896]/50 hover:bg-[#132442] group text-left"
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#00C896] text-[#0A0F1E] group-hover:scale-105 transition-transform">
                      <Zap size={24} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">Simple Payment</h3>
                        <span className="rounded-lg bg-[#1A2235] px-2 py-0.5 text-[10px] text-[#8896B3]">"Just send me money!"</span>
                      </div>
                      <p className="mt-1 text-sm text-[#8896B3]">Basic payment link. Share it, get paid.</p>
                      <p className="text-xs text-[#4E638A] mt-1 italic">Perfect for: Everything else</p>
                    </div>
                  </button>

                  <div className="flex w-full items-center gap-5 rounded-[28px] border border-[#1A2235] bg-[#0D1B35]/50 p-6 opacity-60 grayscale cursor-not-allowed">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EC4899] text-white">
                      <Package size={24} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">Digital Product</h3>
                        <span className="rounded-lg bg-[#1A2235] px-2 py-0.5 text-[10px] text-[#8896B3]">"Buy my design pack - $25"</span>
                        <span className="ml-auto rounded-lg border border-[#1A2235] px-2 py-1 text-[10px] font-bold text-[#8896B3]">Coming Soon</span>
                      </div>
                      <p className="mt-1 text-sm text-[#8896B3]">Sell digital files with instant delivery.</p>
                    </div>
                  </div>

                  <div className="flex w-full items-center gap-5 rounded-[28px] border border-[#1A2235] bg-[#0D1B35]/50 p-6 opacity-60 grayscale cursor-not-allowed">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#06B6D4] text-white">
                      <FileText size={24} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">Payment Request</h3>
                        <span className="rounded-lg bg-[#1A2235] px-2 py-0.5 text-[10px] text-[#8896B3]">"You owe me $50"</span>
                        <span className="ml-auto rounded-lg border border-[#1A2235] px-2 py-1 text-[10px] font-bold text-[#8896B3]">Coming Soon</span>
                      </div>
                      <p className="mt-1 text-sm text-[#8896B3]">Ask someone specific to pay you.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* More Options Section */}
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9] mb-4">More Options</p>
                <div className="flex w-full items-center gap-5 rounded-[28px] border border-[#1A2235] bg-[#0D1B35]/50 p-6 opacity-60 grayscale cursor-not-allowed">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EAB308] text-white">
                    <Gift size={24} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">Fundraiser</h3>
                      <span className="rounded-lg bg-[#1A2235] px-2 py-0.5 text-[10px] text-[#8896B3]">"Help me reach $1,000!"</span>
                      <span className="ml-auto rounded-lg border border-[#1A2235] px-2 py-1 text-[10px] font-bold text-[#8896B3]">Coming Soon</span>
                    </div>
                    <p className="mt-1 text-sm text-[#8896B3]">Collect money toward a goal with progress bar.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Simple Link View ───────────────────────────────── */}
      {view === 'create-simple' && (
        <div className="mx-auto w-full max-w-2xl animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="rounded-[32px] border border-[#1A2235] bg-[#0D1B35] p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-6">Create Simple Link</h2>
            
            <div className="flex flex-col gap-6">
              {/* Title */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">Title</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Tip Jar, Project Payment"
                  className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-4 text-white outline-none focus:border-[#00C896] transition-colors"
                />
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white">Fixed Amount (Optional)</label>
                  <span className="text-[10px] text-[#4E638A]">Leave empty to let sender choose</span>
                </div>
                <div className="relative">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 font-bold text-[#8896B3]">$</span>
                  <input 
                    type="number" 
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] pl-10 pr-16 py-4 text-white outline-none focus:border-[#00C896] transition-colors"
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#4E638A]">USDC</span>
                </div>
              </div>

              {/* Icon Picker */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-white">Choose an Icon</label>
                <div className="rounded-2xl border border-[#1A2235] bg-[#081122] p-4">
                  <IconPicker selected={iconKey} onChange={setIconKey} />
                </div>
              </div>

              {/* Memo */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">Note / Memo</label>
                <textarea 
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="What is this payment for?"
                  rows={3}
                  className="w-full rounded-2xl border border-[#1A2235] bg-[#081122] px-5 py-4 text-white outline-none focus:border-[#00C896] transition-colors resize-none"
                />
              </div>

              <button 
                onClick={handleCreate}
                disabled={!title || isCreating}
                className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#00C896] py-5 text-lg font-bold text-[#0A0F1E] transition-all hover:bg-[#00B085] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {isCreating ? <Loader2 size={24} className="animate-spin" /> : <Zap size={20} />}
                {isCreating ? 'Creating...' : 'Create Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ─────────────────────────────────────────── */}
      {showQR && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-[32px] border border-[#1A2235] bg-[#0D1B35] p-8 text-center animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-6">Scan to Pay</h3>
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
