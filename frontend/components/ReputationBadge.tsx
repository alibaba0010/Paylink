import { ReputationScore } from '@/lib/api';
import { ShieldCheck, TrendingUp, AlertCircle, Clock, Zap } from 'lucide-react';

interface Props {
  reputation: ReputationScore;
}

export function ReputationBadge({ reputation }: Props) {
  const getGradeColors = (grade: string) => {
    switch (grade) {
      case 'S': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'A': return 'bg-[#00C896]/10 text-[#00C896] border-[#00C896]/30';
      case 'B': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'C': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      default: return 'bg-[#1A2235]/50 text-[#8896B3] border-[#1A2235]';
    }
  };

  const getGradeGlow = (grade: string) => {
    switch (grade) {
      case 'S': return 'shadow-[0_0_15px_rgba(168,85,247,0.15)]';
      case 'A': return 'shadow-[0_0_15px_rgba(0,200,150,0.15)]';
      case 'B': return 'shadow-[0_0_15px_rgba(59,130,246,0.15)]';
      default: return '';
    }
  };

  const penalty = 100 - reputation.breakdown.trust;

  return (
    <div className={`mt-6 rounded-2xl border p-5 backdrop-blur-sm ${getGradeColors(reputation.grade)} ${getGradeGlow(reputation.grade)}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="shrink-0" />
          <h3 className="font-bold tracking-wide">Reputation Score</h3>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-[Space_Grotesk] font-bold tracking-tighter">{reputation.score}</span>
          <span className="text-sm opacity-70 font-medium">/ 1000</span>
        </div>
      </div>
      
      <div className="mb-4 flex items-center justify-between text-sm">
        <span className="font-medium opacity-80">Tier: <strong className="font-bold opacity-100">{reputation.label}</strong></span>
        <span className="font-bold text-lg px-3 py-0.5 rounded-lg bg-black/20">{reputation.grade}</span>
      </div>

      <div className="space-y-2 text-xs opacity-80">
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1.5"><TrendingUp size={14} /> Volume & Activity</span>
          <span className="font-mono">{(reputation.breakdown.volume + reputation.breakdown.activity)} pts</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1.5"><Clock size={14} /> Longevity & Consistency</span>
          <span className="font-mono">{(reputation.breakdown.longevity + reputation.breakdown.consistency)} pts</span>
        </div>
        <div className="flex justify-between items-center text-red-400">
          <span className="flex items-center gap-1.5"><AlertCircle size={14} /> Trust Penalty</span>
          <span className="font-mono">{penalty > 0 ? `-${penalty}` : 0} pts</span>
        </div>
      </div>

      {reputation.loan_eligibility_usdc > 0 && (
        <div className="mt-5 pt-4 border-t border-current/10 flex items-start gap-2">
          <Zap size={16} className="shrink-0 mt-0.5 text-amber-400" />
          <div>
            <p className="text-xs font-semibold text-white">Eligible for Credit Advance</p>
            <p className="text-[10px] text-white/60 mt-0.5 leading-tight">
              Based on this score, this account qualifies for up to <strong className="text-amber-400">${reputation.loan_eligibility_usdc} USDC</strong> in advance via lending partners.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
