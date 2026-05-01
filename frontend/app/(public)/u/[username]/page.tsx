import { notFound }     from 'next/navigation';
import { PaymentForm }  from '@/components/PaymentForm';
import { fetchUserProfile } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';
import { CopyValueButton } from '@/components/CopyValueButton';
import { UserAvatar } from '@/components/UserAvatar';
import { shortenAddress } from '@/lib/format';
import { UserProfileClientTabs } from './UserProfileClientTabs';
import { fetchReputationScore } from '@/lib/api';
import { ReputationBadge } from '@/components/ReputationBadge';

interface Props { params: Promise<{ username: string }> }

// Next.js App Router Page
export default async function UserPayPage({ params }: Props) {
  const { username } = await params;
  const profile = await fetchUserProfile(username);
  if (!profile) return notFound();

  const reputation = await fetchReputationScore(username);

  const pageUrl = `https://paylink.app/u/${username}`;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#112B4A_0%,_#0A0F1E_45%,_#050814_100%)] px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col">
        <div className="mb-8 flex justify-center sm:justify-start">
          <BrandLogo />
        </div>

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,420px)] lg:items-start">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-center backdrop-blur sm:p-8 lg:text-left">
            <div className="flex flex-col items-center gap-3 text-center lg:items-start lg:text-left">
              <div className="relative">
                <UserAvatar name={profile.display_name} className="h-20 w-20 text-3xl border-2" />
                {profile.is_verified && (
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-[#00C896] p-0.5 text-xs">✓</span>
                )}
              </div>

              <h1 className="font-[Space_Grotesk] text-2xl font-bold text-white sm:text-3xl">
                {profile.display_name}
              </h1>
              <p className="text-sm text-[#8896B3]">@{profile.username}</p>
              {profile.bio && (
                <p className="max-w-md text-center text-sm leading-relaxed text-[#F4F7FF] lg:text-left">
                  {profile.bio}
                </p>
              )}

              {reputation && (
                <div className="w-full text-left">
                  <ReputationBadge reputation={reputation} />
                </div>
              )}
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Payout address</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-[#D6DEEE]">{shortenAddress(profile.wallet_address, 6, 6)}</p>
                  <CopyValueButton value={profile.wallet_address} title="Copy payout address" />
                </div>
                <p className="mt-3 text-xs text-[#8896B3]">
                  Shared in shortened form for privacy. Use copy to get the full address.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0B1630] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-[#7BF0C9]">Pay page</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="break-all font-mono text-sm text-[#D6DEEE]">{pageUrl}</p>
                  <CopyValueButton value={pageUrl} title="Copy PayLink URL" className="shrink-0" />
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <UserProfileClientTabs 
              profile={profile} 
              username={username} 
              pageUrl={pageUrl} 
            />
          </section>
        </div>

        <p className="pb-4 pt-8 text-center text-xs text-[#8896B3] sm:pb-8 sm:text-left">
          Powered by{' '}
          <a href="https://paylink.app" className="text-[#00C896] hover:underline">
            PayLink
          </a>
          {' '}· Built on Solana
        </p>
      </div>
    </main>
  );
}
