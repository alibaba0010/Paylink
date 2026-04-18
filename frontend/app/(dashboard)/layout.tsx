import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0A0F1E] text-white lg:flex">
      <aside className="hidden w-72 border-r border-[#1A2235] bg-[#0D1B35] p-6 lg:flex lg:flex-col lg:gap-4">
        <BrandLogo imageClassName="h-11" />

        <nav className="mt-4 flex flex-col gap-2">
          <Link href="/overview" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:bg-[#1A2235] hover:text-[#00C896]">Overview</Link>
          <Link href="/paylinks" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:bg-[#1A2235] hover:text-[#00C896]">PayLinks</Link>
          <Link href="/payments" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:bg-[#1A2235] hover:text-[#00C896]">Payments</Link>
          <Link href="/payroll" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:bg-[#1A2235] hover:text-[#00C896]">Payroll</Link>
          <Link href="/history" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:bg-[#1A2235] hover:text-[#00C896]">History</Link>
          <Link href="/offramp" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:bg-[#1A2235] hover:text-[#00C896]">Off-Ramp</Link>
        </nav>

        <div className="mt-auto">
          <Link href="/settings" className="rounded-lg px-4 py-3 text-[#8896B3] transition-colors hover:text-white">Settings</Link>
        </div>
      </aside>

      <main className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-white/5 bg-[#0A0F1E]/95 px-4 py-4 backdrop-blur sm:px-6 lg:hidden">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <BrandLogo imageClassName="h-9" />
              <Link href="/onboard" className="rounded-xl border border-[#1A2235] px-4 py-2 text-sm text-[#D6DEEE]">
                Onboard
              </Link>
            </div>
            <nav className="flex gap-2 overflow-x-auto pb-1 text-sm">
              <Link href="/overview" className="whitespace-nowrap rounded-full border border-[#1A2235] px-4 py-2 text-[#8896B3]">Overview</Link>
              <Link href="/paylinks" className="whitespace-nowrap rounded-full border border-[#1A2235] px-4 py-2 text-[#8896B3]">PayLinks</Link>
              <Link href="/payments" className="whitespace-nowrap rounded-full border border-[#1A2235] px-4 py-2 text-[#8896B3]">Payments</Link>
              <Link href="/payroll" className="whitespace-nowrap rounded-full border border-[#1A2235] px-4 py-2 text-[#8896B3]">Payroll</Link>
              <Link href="/history" className="whitespace-nowrap rounded-full border border-[#1A2235] px-4 py-2 text-[#8896B3]">History</Link>
              <Link href="/offramp" className="whitespace-nowrap rounded-full border border-[#1A2235] px-4 py-2 text-[#8896B3]">Off-Ramp</Link>
            </nav>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
