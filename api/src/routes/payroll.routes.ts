import { FastifyInstance } from 'fastify';
import { DatabaseConnectionError } from '../db/supabase-client';
import { PayrollService, PayrollInputError } from '../services/payroll.service';

const payrollService = new PayrollService();

export default async function payrollRoutes(fastify: FastifyInstance) {

  /**
   * POST /payroll
   * Create a named payroll group with multiple members in one shot.
   * Body: {
   *   employer_wallet: string,
   *   title: string,
   *   notification_email?: string,
   *   members: Array<{
   *     username?: string,          // PayLink username (resolves to wallet)
   *     wallet_address?: string,    // OR raw Solana wallet (no PayLink account needed)
   *     label?: string,             // display label for wallet-only members
   *     amount_usdc: number,
   *     memo?: string
   *   }>
   * }
   */
  fastify.post('/payroll', async (request, reply) => {
    const body = request.body as {
      employer_wallet?: string;
      title?: string;
      notification_email?: string;
      members?: {
        username?: string;
        wallet_address?: string;
        label?: string;
        amount_usdc?: number;
        memo?: string;
      }[];
    };

    const { employer_wallet, title, notification_email, members } = body;

    if (!employer_wallet || !title || !members?.length) {
      return reply.code(400).send({
        success: false,
        message: 'employer_wallet, title, and at least one member are required',
      });
    }

    try {
      const payroll = await payrollService.createPayroll({
        employer_wallet,
        title,
        notification_email,
        members: members.map((m) => ({
          username: m.username,
          wallet_address: m.wallet_address,
          label: m.label,
          amount_usdc: Number(m.amount_usdc ?? 0),
          memo: m.memo,
        })),
      });

      return reply.code(201).send({ success: true, payroll });
    } catch (error) {
      if (error instanceof PayrollInputError) {
        return reply.code(400).send({ success: false, message: error.message });
      }
      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({ success: false, message: error.message });
      }
      throw error;
    }
  });

  /**
   * GET /payroll?employer_wallet=<wallet>
   * List all active payrolls for an employer, each with members and totals.
   */
  fastify.get('/payroll', async (request, reply) => {
    const { employer_wallet } = request.query as { employer_wallet?: string };

    if (!employer_wallet) {
      return reply.code(400).send({
        success: false,
        message: 'employer_wallet query param is required',
      });
    }

    try {
      const payrolls = await payrollService.listPayrolls(employer_wallet);
      return { success: true, payrolls };
    } catch (error) {
      if (error instanceof PayrollInputError) {
        return reply.code(400).send({ success: false, message: error.message });
      }
      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({ success: false, message: error.message });
      }
      throw error;
    }
  });

  /**
   * PATCH /payroll/:id/deactivate
   * Deactivate an entire payroll group. Body: { employer_wallet }
   */
  fastify.patch('/payroll/:id/deactivate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employer_wallet } = request.body as { employer_wallet?: string };

    if (!employer_wallet) {
      return reply.code(400).send({
        success: false,
        message: 'employer_wallet is required',
      });
    }

    try {
      await payrollService.deactivatePayroll(id, employer_wallet);
      return { success: true };
    } catch (error) {
      if (error instanceof PayrollInputError) {
        return reply.code(400).send({ success: false, message: error.message });
      }
      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({ success: false, message: error.message });
      }
      throw error;
    }
  });
}
