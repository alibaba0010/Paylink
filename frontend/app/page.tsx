import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { GetStartedButton } from '@/components/GetStartedButton';

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_#15345B_0%,_#0A0F1E_45%,_#050814_100%)] px-4 py-6 text-center text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-center sm:justify-start">
          <BrandLogo className="rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur" imageClassName="h-9 sm:h-10" />
        </header>

        <section className="relative flex flex-1 items-center justify-center py-12 sm:py-16 lg:py-20">
          <div className="absolute inset-x-4 top-10 -z-10 h-48 rounded-full bg-[#00C896]/10 blur-3xl sm:inset-x-20 sm:h-64" />
          <div className="w-full max-w-5xl rounded-[32px] border border-white/10 bg-white/5 px-5 py-8 shadow-2xl shadow-black/30 backdrop-blur sm:px-8 sm:py-12 lg:px-14 lg:py-16">
            <div className="mx-auto max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#7BF0C9] sm:text-sm">
                Solana payment rails for modern teams
              </p>
              <h1 className="mt-5 font-[Space_Grotesk] text-4xl font-bold leading-tight sm:text-5xl lg:text-7xl">
                Pay smarter. Earn more. Stay onchain.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#A9B7D3] sm:text-lg lg:text-xl">
                PayLink gives African creators and distributed teams a clean way to receive
                USDC, share payment pages, and move from wallet to local cashflow.
              </p>
            </div>

            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row">
              <GetStartedButton />
              <Link
                href="/docs"
                className="rounded-2xl border border-[#1D2E4E] bg-[#0D1B35] px-6 py-4 text-base font-bold text-white transition hover:bg-[#132445] sm:min-w-44"
              >
                View Docs
              </Link>
            </div>

            <div className="mt-8 grid gap-4 text-left sm:mt-12 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-[#0B1630]/90 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-[#7BF0C9]">Share</p>
                <p className="mt-3 text-lg font-semibold">Custom payment pages</p>
                <p className="mt-2 text-sm leading-6 text-[#8EA0C5]">
                  Give clients and employers one link that works cleanly on phones, tablets, and desktops.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0B1630]/90 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-[#7BF0C9]">Receive</p>
                <p className="mt-3 text-lg font-semibold">USDC without friction</p>
                <p className="mt-2 text-sm leading-6 text-[#8EA0C5]">
                  Connect a Solana wallet, claim your username, and start collecting payments instantly.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0B1630]/90 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-[#7BF0C9]">Move</p>
                <p className="mt-3 text-lg font-semibold">Off-ramp when needed</p>
                <p className="mt-2 text-sm leading-6 text-[#8EA0C5]">
                  Keep funds onchain or route them into local currency when it fits your workflow.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
