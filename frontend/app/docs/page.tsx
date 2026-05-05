import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

export default function DocsPage() {
  const sections = [
    { id: 'vision', title: 'Core Vision', icon: '🚀' },
    { id: 'architecture', title: 'System Architecture', icon: '🏗️' },
    { id: 'features', title: 'Key Features', icon: '✨' },
    { id: 'structure', title: 'Project Structure', icon: '📂' },
    { id: 'tech-stack', title: 'Technical Stack', icon: '🛠️' },
    { id: 'getting-started', title: 'Getting Started', icon: '🏁' },
    { id: 'off-ramp', title: 'Off-Ramp Infrastructure', icon: '🏦' },
  ];

  return (
    <div className="min-h-screen bg-[#050814] text-white selection:bg-[#7BF0C9] selection:text-[#050814]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#050814]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="transition hover:opacity-80">
            <BrandLogo imageClassName="h-8" />
          </Link>
          <div className="flex items-center gap-4">
            <Link 
              href="/"
              className="text-sm font-medium text-[#A9B7D3] transition hover:text-white"
            >
              Back to Home
            </Link>
            <Link
              href="/onboard"
              className="rounded-xl bg-[#7BF0C9] px-4 py-2 text-sm font-bold text-[#050814] transition hover:bg-[#5EEBB4]"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 py-10 lg:flex-row">
          {/* Sidebar */}
          <aside className="lg:w-64 lg:shrink-0">
            <nav className="sticky top-28 space-y-1">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#7BF0C9]/50">
                Documentation
              </p>
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[#A9B7D3] transition hover:bg-white/5 hover:text-white"
                >
                  <span className="text-lg">{section.icon}</span>
                  {section.title}
                </a>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <main className="flex-1 space-y-16 pb-20 lg:max-w-3xl">
            <section>
              <h1 className="font-[Space_Grotesk] text-4xl font-bold tracking-tight sm:text-5xl">
                Documentation
              </h1>
              <p className="mt-4 text-lg text-[#A9B7D3]">
                Everything you need to know about PayLink, the on-chain payroll infrastructure for Africa's digital workforce.
              </p>
            </section>

            <section id="vision" className="scroll-mt-28">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🚀</span>
                <h2 className="font-[Space_Grotesk] text-2xl font-bold">Core Vision</h2>
              </div>
              <div className="mt-6 space-y-4 text-[#A9B7D3] leading-relaxed">
                <p>
                  Nigerian developers and freelancers often lose 10-20% of their hard-earned income to predatory FX conversion fees and unreliable traditional payment rails.
                </p>
                <div className="grid gap-4 mt-8">
                  <div className="rounded-2xl border border-white/5 bg-white/5 p-6">
                    <h3 className="font-semibold text-white">Zero Hidden Fees</h3>
                    <p className="mt-2 text-sm">Utilizing USDC on Solana for settlement reduces overhead to less than 1%.</p>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/5 p-6">
                    <h3 className="font-semibold text-white">Instant Finality</h3>
                    <p className="mt-2 text-sm">Moving from 3-5 day wire transfers to sub-second settlement.</p>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/5 p-6">
                    <h3 className="font-semibold text-white">Financial Autonomy</h3>
                    <p className="mt-2 text-sm">Providing portable, on-chain payment history independently of centralized platforms.</p>
                  </div>
                </div>
              </div>
            </section>

            <section id="architecture" className="scroll-mt-28">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🏗️</span>
                <h2 className="font-[Space_Grotesk] text-2xl font-bold">System Architecture</h2>
              </div>
              <div className="mt-6 space-y-6 text-[#A9B7D3] leading-relaxed">
                <p>PayLink is designed with a modular, scalable architecture consisting of four primary layers:</p>
                <ul className="space-y-4">
                  <li className="flex gap-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7BF0C9]/10 text-xs font-bold text-[#7BF0C9]">1</span>
                    <div>
                      <strong className="text-white">Blockchain Layer (Anchor/Rust):</strong>
                      <p className="mt-1">Secure escrow smart contracts and payroll stream logic on the Solana network.</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7BF0C9]/10 text-xs font-bold text-[#7BF0C9]">2</span>
                    <div>
                      <strong className="text-white">API Layer (Node.js/Fastify):</strong>
                      <p className="mt-1">High-performance RESTful services for transaction orchestration and user management.</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7BF0C9]/10 text-xs font-bold text-[#7BF0C9]">3</span>
                    <div>
                      <strong className="text-white">Frontend Layer (Next.js 14):</strong>
                      <p className="mt-1">A responsive, premium web interface providing a clean user experience.</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7BF0C9]/10 text-xs font-bold text-[#7BF0C9]">4</span>
                    <div>
                      <strong className="text-white">Database Layer (Supabase):</strong>
                      <p className="mt-1">Reliable persistence for user profiles, transaction history, and schedules.</p>
                    </div>
                  </li>
                </ul>
              </div>
            </section>

            <section id="features" className="scroll-mt-28">
              <div className="flex items-center gap-3">
                <span className="text-3xl">✨</span>
                <h2 className="font-[Space_Grotesk] text-2xl font-bold">Key Features</h2>
              </div>
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent p-8">
                  <div className="text-2xl mb-4">🔗</div>
                  <h3 className="text-lg font-bold">Reusable PayLinks</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#A9B7D3]">
                    Every user receives a personalized, shareable URL. Senders can pay in USDC instantly without complex onboarding.
                  </p>
                </div>
                <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent p-8">
                  <div className="text-2xl mb-4">🛡️</div>
                  <h3 className="text-lg font-bold">Smart Escrow</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#A9B7D3]">
                    Funds are held in secure, program-derived addresses (PDAs) with support for one-time links and scheduled payouts.
                  </p>
                </div>
                <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent p-8">
                  <div className="text-2xl mb-4">📅</div>
                  <h3 className="text-lg font-bold">Payroll Streams</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#A9B7D3]">
                    Scheduled recurring payments (weekly, bi-weekly, monthly) for distributed teams and contractors.
                  </p>
                </div>
                <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent p-8">
                  <div className="text-2xl mb-4">💳</div>
                  <h3 className="text-lg font-bold">Native Off-Ramping</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#A9B7D3]">
                    Integrated liquidity bridges allowing workers to convert USDC to local currency and deposit to bank accounts.
                  </p>
                </div>
              </div>
            </section>

            <section id="tech-stack" className="scroll-mt-28">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🛠️</span>
                <h2 className="font-[Space_Grotesk] text-2xl font-bold">Technical Stack</h2>
              </div>
              <div className="mt-8 overflow-hidden rounded-2xl border border-white/5 bg-white/5">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/5 font-semibold text-white">
                      <th className="px-6 py-4">Component</th>
                      <th className="px-6 py-4">Technology</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[#A9B7D3]">
                    <tr>
                      <td className="px-6 py-4 font-medium text-white">Blockchain</td>
                      <td className="px-6 py-4">Solana (Rust / Anchor)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-white">Backend</td>
                      <td className="px-6 py-4">Fastify (TypeScript)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-white">Frontend</td>
                      <td className="px-6 py-4">Next.js 14 (App Router)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-white">Database</td>
                      <td className="px-6 py-4">PostgreSQL (Supabase)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-white">RPC</td>
                      <td className="px-6 py-4">Helius</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section id="getting-started" className="scroll-mt-28">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🏁</span>
                <h2 className="font-[Space_Grotesk] text-2xl font-bold">Getting Started</h2>
              </div>
              <div className="mt-6 space-y-6 text-[#A9B7D3] leading-relaxed">
                <div className="rounded-2xl bg-[#0B1630] p-6 font-mono text-sm border border-white/5">
                  <p className="text-[#7BF0C9]"># Clone the repository</p>
                  <p className="mt-1">git clone https://github.com/your-org/paylink.git</p>
                  <p className="mt-4 text-[#7BF0C9]"># Run development environment</p>
                  <p className="mt-1">make dev</p>
                </div>
                <p>
                  The development environment will start the API service, wait for a healthy status, and subsequently launch the Next.js frontend.
                </p>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
