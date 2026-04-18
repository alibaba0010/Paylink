import { notFound } from 'next/navigation';
import { PaymentForm } from '@/components/PaymentForm';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { fetchPaymentLinkBySlug, trackLinkView } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';
import { CopyValueButton } from '@/components/CopyValueButton';
import { UserAvatar } from '@/components/UserAvatar';
import { IconAvatar } from '@/components/IconPicker';
import { shortenAddress } from '@/lib/format';

interface Props { params: Promise<{ slug: string }> }

export default async function PublicLinkPage({ params }: Props) {
  const { slug } = await params;
  let linkData;
  
  try {
    linkData = await fetchPaymentLinkBySlug(slug);
    // Track view asynchronously (server-side hit)
    void trackLinkView(linkData.id).catch(() => {});
  } catch (err) {
    return notFound();
  }

  const { owner, ...link } = linkData;
  const pageUrl = `https://paylink.app/l/${slug}`;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#112B4A_0%,_#0A0F1E_45%,_#050814_100%)] px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col">
        <div className="mb-8 flex justify-center sm:justify-start">
          <BrandLogo />
        </div>

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,420px)] lg:items-start">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8">
            <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
              <IconAvatar iconKey={link.icon_key} size={32} className="h-20 w-20 shadow-2xl" />
              
              <div className="space-y-2">
                <h1 className="font-[Space_Grotesk] text-3xl font-bold text-white sm:text-4xl">
                  {link.title}
                </h1>
                {link.description && (
                  <p className="max-w-md text-sm leading-relaxed text-[#8896B3]">
                    {link.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 pr-5">
                <UserAvatar name={owner.display_name} className="h-10 w-10 text-xs" />
                <div className="text-left">
                  <p className="text-[10px] uppercase tracking-widest text-[#7BF0C9]">Owner</p>
                  <p className="text-sm font-bold text-white">{owner.display_name}</p>
                </div>
              </div>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4 text-left">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Recipient</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-[#D6DEEE]">{shortenAddress(owner.wallet_address, 8, 8)}</p>
                  <CopyValueButton value={owner.wallet_address} title="Copy wallet" />
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4 text-left">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Share Link</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="break-all font-mono text-sm text-[#D6DEEE]">{pageUrl}</p>
                  <CopyValueButton value={pageUrl} title="Copy URL" className="shrink-0" />
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <div className="w-full rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-5 shadow-2xl shadow-black/30 sm:p-8">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-bold text-white">Make a Payment</h2>
                <p className="text-sm text-[#8896B3] mt-1">Direct USDC transfer via Solana</p>
              </div>
              
              <PaymentForm
                linkId={link.id}
                recipientUsername={owner.username}
                recipientWallet={owner.wallet_address}
                fixedAmount={link.amount_usdc}
              />
            </div>

            <div className="flex flex-col items-center gap-3 rounded-[28px] border border-[#1A2235] bg-[#0D1B35] p-6 text-center">
              <p className="text-xs text-[#8896B3]">Scan to pay</p>
              <QRCodeDisplay url={pageUrl} size={140} />
            </div>
          </section>
        </div>

        <p className="pb-4 pt-12 text-center text-xs text-[#8896B3]">
          Powered by{' '}
          <a href="/" className="text-[#00C896] hover:underline font-bold">
            PayLink
          </a>
          {' '}· Multi-Link Payment System
        </p>
      </div>
    </main>
  );
}
