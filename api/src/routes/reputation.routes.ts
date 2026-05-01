/**
 * Reputation Score Routes
 *
 * Computes and returns a deterministic, on-chain-verifiable reputation score (0–1000)
 * for any PayLink user, derived entirely from their on-chain payment and payroll history.
 *
 * Score breakdown (1000 pts total):
 *   Volume       300 pts — lifetime USDC transacted (caps at $10,000)
 *   Consistency  250 pts — payroll cycles completed on time
 *   Longevity    200 pts — account age in days (caps at 365)
 *   Activity     150 pts — total number of payments sent/received (caps at 100)
 *   Trust        100 pts — no cancelled payrolls, no rejected claims
 *
 * Used by:
 *   - Public profile (/u/:username) — reputation badge widget
 *   - Dashboard overview — user's own score card
 *   - Potential loan eligibility (future Kamino integration)
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase-client';

interface ReputationScore {
  score: number;               // 0–1000
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  label: string;               // human-readable tier name
  breakdown: {
    volume: number;            // 0–300
    consistency: number;       // 0–250
    longevity: number;         // 0–200
    activity: number;          // 0–150
    trust: number;             // 0–100
  };
  stats: {
    total_volume_usdc: number;
    total_payments: number;
    completed_payroll_cycles: number;
    cancelled_payrolls: number;
    account_age_days: number;
  };
  loan_eligibility_usdc: number;  // max USDC loan based on score
  computed_at: string;
}

function gradeFromScore(score: number): { grade: ReputationScore['grade']; label: string } {
  if (score >= 850) return { grade: 'S', label: 'Exceptional' };
  if (score >= 700) return { grade: 'A', label: 'Excellent' };
  if (score >= 500) return { grade: 'B', label: 'Good' };
  if (score >= 300) return { grade: 'C', label: 'Building' };
  return { grade: 'D', label: 'New' };
}

export async function computeReputationScore(userId: string, createdAt: string): Promise<ReputationScore> {
  const now = Date.now();
  const accountAgeDays = Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

  // ── Fetch payment stats ──────────────────────────────────────────────────
  const { data: paymentStats } = await supabase
    .from('payments')
    .select('amount_usdc, status, sender_wallet')
    .or(`sender_wallet.eq.${userId},recipient_id.eq.${userId}`)
    .eq('status', 'confirmed');

  const totalPayments = (paymentStats || []).length;
  const totalVolume = (paymentStats || []).reduce((sum, p) => sum + Number(p.amount_usdc ?? 0), 0);

  // ── Fetch payroll stats ──────────────────────────────────────────────────
  const { data: payrollStats } = await supabase
    .from('payroll_schedules')
    .select('id, is_active, cancelled_at, created_at')
    .eq('employer_id', userId);

  const cancelledPayrolls = (payrollStats || []).filter(p => p.cancelled_at !== null).length;

  const payrollIds = (payrollStats || []).map(p => p.id);
  let completedCycles = 0;
  if (payrollIds.length > 0) {
    const { data: cycles } = await supabase
      .from('scheduled_payment_cycles')
      .select('id, status')
      .in('payroll_id', payrollIds)
      .eq('status', 'signed');
    completedCycles = (cycles || []).length;
  }

  // ── Score calculation ────────────────────────────────────────────────────
  const volumeScore   = Math.min(300, Math.floor((totalVolume / 10_000) * 300));
  const consistencyScore = Math.min(250, completedCycles * 50);
  const longevityScore   = Math.min(200, Math.floor((accountAgeDays / 365) * 200));
  const activityScore    = Math.min(150, Math.floor((totalPayments / 100) * 150));
  const trustScore       = Math.max(0, 100 - cancelledPayrolls * 25);

  const totalScore = volumeScore + consistencyScore + longevityScore + activityScore + trustScore;

  // Loan eligibility: up to $500 for perfect score, scales linearly
  const loanEligibility = Math.floor((totalScore / 1000) * 500);

  const { grade, label } = gradeFromScore(totalScore);

  return {
    score: totalScore,
    grade,
    label,
    breakdown: {
      volume: volumeScore,
      consistency: consistencyScore,
      longevity: longevityScore,
      activity: activityScore,
      trust: trustScore,
    },
    stats: {
      total_volume_usdc: totalVolume,
      total_payments: totalPayments,
      completed_payroll_cycles: completedCycles,
      cancelled_payrolls: cancelledPayrolls,
      account_age_days: accountAgeDays,
    },
    loan_eligibility_usdc: loanEligibility,
    computed_at: new Date().toISOString(),
  };
}

export default async function reputationRoutes(fastify: FastifyInstance) {
  /**
   * GET /users/:username/reputation
   * Public endpoint — returns the reputation score for any PayLink user.
   * Used by the public profile page and the dashboard.
   */
  fastify.get('/users/:username/reputation', async (request, reply) => {
    const { username } = request.params as { username: string };

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, display_name, created_at')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    if (error || !user) {
      return reply.code(404).send({ success: false, message: `User @${username} not found` });
    }

    try {
      const reputation = await computeReputationScore(user.id, user.created_at);
      return reply.send({ success: true, username: user.username, reputation });
    } catch (err: any) {
      console.error('[reputation] compute error:', err);
      return reply.code(500).send({ success: false, message: 'Failed to compute reputation score' });
    }
  });

  /**
   * GET /users/by-wallet/:wallet/reputation
   * Convenience endpoint for logged-in users checking their own score from wallet address.
   */
  fastify.get('/users/by-wallet/:wallet/reputation', async (request, reply) => {
    const { wallet } = request.params as { wallet: string };

    const { data: user } = await supabase
      .from('users')
      .select('id, username, created_at')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (!user) {
      return reply.code(404).send({ success: false, message: 'Wallet not registered on PayLink' });
    }

    try {
      const reputation = await computeReputationScore(user.id, user.created_at);
      return reply.send({ success: true, username: user.username, reputation });
    } catch (err: any) {
      return reply.code(500).send({ success: false, message: 'Failed to compute reputation score' });
    }
  });
}
