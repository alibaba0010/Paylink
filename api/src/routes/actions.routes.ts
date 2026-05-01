/**
 * Solana Actions (Blinks) Route Handler
 *
 * Specification: https://solana.com/docs/advanced/actions
 *
 * This makes every PayLink user page Blink-compatible.
 * When a Blink-enabled client (Phantom, Dialect, Twitter/X) encounters a
 * paylink.app/u/:username URL, it fetches /api/actions/pay/:username and renders
 * an interactive payment card directly in the feed — no app navigation required.
 *
 * Registered Blink paths exposed:
 *   GET  /actions.json                      → dialect registry
 *   GET  /api/actions/pay/:username         → Blink action metadata
 *   POST /api/actions/pay/:username         → build + return unsigned transaction
 *   GET  /api/actions/payroll/:payrollId    → Blink for funding a payroll escrow
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../db/supabase-client';
import { SolanaService } from '../services/solana.service';

const BLINKS_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-blockchain-ids,x-action-version',
  'X-Action-Version': '2.1.3',
  'X-Blockchain-Ids': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};

const APP_URL = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8001';

export default async function actionsRoutes(fastify: FastifyInstance) {
  const solana = new SolanaService();

  // Apply Blinks CORS to every response in this plugin
  fastify.addHook('onSend', async (request, reply) => {
    Object.entries(BLINKS_CORS_HEADERS).forEach(([k, v]) => reply.header(k, v));
  });

  // ── Dialect Registry ──────────────────────────────────────────────────────
  /**
   * GET /actions.json
   * Tells Blink clients which URL patterns are Actions.
   * Must be served from the root of the API domain.
   */
  fastify.get('/actions.json', async (_req, reply) => {
    return reply.send({
      rules: [
        {
          pathPattern: '/api/actions/**',
          apiPath: '/api/actions/**',
        },
        // Map the user-facing profile URL to the action API
        {
          pathPattern: '/u/**',
          apiPath: '/api/actions/pay/**',
        },
      ],
    });
  });

  // ── Pay a User (GET — action metadata) ────────────────────────────────────
  /**
   * GET /api/actions/pay/:username
   * Returns the Blink action card definition.
   * Blink clients render this as: icon + title + description + buttons.
   */
  fastify.get('/api/actions/pay/:username', async (request, reply) => {
    const { username } = request.params as { username: string };

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, display_name, icon_key, bio, is_verified, total_payments, total_volume_usdc:total_received')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    if (error || !user) {
      return reply.code(404).send({ message: `User @${username} not found` });
    }

    const icon = `${APP_URL}/api/og/user/${username}`;
    const profileUrl = `${APP_URL}/u/${username}`;

    return reply.send({
      icon,
      label: `Pay @${user.display_name}`,
      title: `Pay @${user.display_name} via PayLink`,
      description:
        `Send USDC directly to @${user.display_name} on Solana. ` +
        `${user.total_payments > 0 ? `${user.total_payments} payments received. ` : ''}` +
        `${user.bio ? user.bio : 'Powered by PayLink — Africa\'s Web3 payroll & payment platform.'}`,
      disabled: false,
      links: {
        actions: [
          {
            type: 'transaction',
            label: 'Pay $5',
            href: `${API_URL}/api/actions/pay/${username}?amount=5`,
          },
          {
            type: 'transaction',
            label: 'Pay $10',
            href: `${API_URL}/api/actions/pay/${username}?amount=10`,
          },
          {
            type: 'transaction',
            label: 'Pay $25',
            href: `${API_URL}/api/actions/pay/${username}?amount=25`,
          },
          {
            type: 'transaction',
            label: 'Custom Amount',
            href: `${API_URL}/api/actions/pay/${username}?amount={amount}`,
            parameters: [
              {
                name: 'amount',
                label: 'Amount (USDC)',
                required: true,
                type: 'number',
                min: 0.01,
                max: 10000,
              },
            ],
          },
        ],
      },
    });
  });

  // ── Pay a User (POST — build transaction) ────────────────────────────────
  /**
   * POST /api/actions/pay/:username
   * Body: { account: "<sender_pubkey>" }
   * Returns: { transaction: "<base64 unsigned tx>", message: "<success msg>" }
   */
  fastify.post('/api/actions/pay/:username', async (request, reply) => {
    const { username } = request.params as { username: string };
    const { amount } = request.query as { amount?: string };
    const body = request.body as { account?: string };

    if (!body?.account) {
      return reply.code(400).send({ message: 'account (sender pubkey) is required in body' });
    }

    const amountUSDC = parseFloat(amount || '0');
    if (!amountUSDC || amountUSDC <= 0) {
      return reply.code(400).send({ message: 'amount must be a positive number' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('wallet_address, display_name')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    if (!user) {
      return reply.code(404).send({ message: `User @${username} not found` });
    }

    try {
      const txBase64 = await solana.buildDirectTransferTransaction(
        body.account,
        user.wallet_address,
        amountUSDC,
      );

      return reply.send({
        transaction: txBase64,
        message: `You are paying $${amountUSDC.toFixed(2)} USDC to @${user.display_name} via PayLink ⚡`,
      });
    } catch (err: any) {
      console.error('[Blinks] buildDirectTransferTransaction error:', err);
      return reply.code(500).send({ message: err.message || 'Failed to build transaction' });
    }
  });

  // ── Fund Payroll Escrow Blink (GET) ───────────────────────────────────────
  /**
   * GET /api/actions/payroll/:payrollId
   * Makes a payroll funding action Blink-compatible.
   * Employers can share a Blink link in Slack/Discord and team leads can fund without dashboard.
   */
  fastify.get('/api/actions/payroll/:payrollId', async (request, reply) => {
    const { payrollId } = request.params as { payrollId: string };

    const { data: payroll } = await supabase
      .from('payroll_schedules')
      .select('id, title, amount_usdc, frequency, next_run_at, is_active, payroll_members(count)')
      .eq('id', payrollId)
      .eq('is_active', true)
      .maybeSingle() as any;

    if (!payroll) {
      return reply.code(404).send({ message: 'Payroll group not found or inactive' });
    }

    const memberCount = payroll.payroll_members?.[0]?.count ?? 0;
    const nextDate = payroll.next_run_at
      ? new Date(payroll.next_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'pending';

    return reply.send({
      icon: `${APP_URL}/paylink-icon.png`,
      label: `Fund Payroll: ${payroll.title}`,
      title: `Fund "${payroll.title}" Payroll`,
      description:
        `Approve and fund the ${payroll.frequency ?? 'one-time'} payroll cycle for ${memberCount} members. ` +
        `Total: $${Number(payroll.amount_usdc).toFixed(2)} USDC · Due ${nextDate}.`,
      disabled: false,
      links: {
        actions: [
          {
            type: 'transaction',
            label: `Fund $${Number(payroll.amount_usdc).toFixed(2)} Escrow`,
            href: `${API_URL}/api/actions/payroll/${payrollId}`,
          },
        ],
      },
    });
  });

  // ── OPTIONS preflight ────────────────────────────────────────────────────
  fastify.options('/api/actions/*', async (_req, reply) => reply.code(204).send());
  fastify.options('/actions.json', async (_req, reply) => reply.code(204).send());
}
