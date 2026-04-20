import { FastifyInstance } from "fastify";
import { DatabaseConnectionError } from "../db/supabase-client";
import { PayrollService, PayrollInputError } from "../services/payroll.service";

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
  fastify.post("/payroll", async (request, reply) => {
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
        message: "employer_wallet, title, and at least one member are required",
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
    } catch (error: any) {
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
   * List all active payroll_schedules for an employer, each with members and totals.
   */
  fastify.get("/payroll", async (request, reply) => {
    const { employer_wallet } = request.query as { employer_wallet?: string };

    if (!employer_wallet) {
      return reply.code(400).send({
        success: false,
        message: "employer_wallet query param is required",
      });
    }

    try {
      const payroll_schedules =
        await payrollService.listPayrolls(employer_wallet);
      return { success: true, payroll_schedules };
    } catch (error: any) {
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
  fastify.patch("/payroll/:id/deactivate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employer_wallet } = request.body as { employer_wallet?: string };

    if (!employer_wallet) {
      return reply.code(400).send({
        success: false,
        message: "employer_wallet is required",
      });
    }

    try {
      await payrollService.deactivatePayroll(id, employer_wallet);
      return { success: true };
    } catch (error: any) {
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
   * PUT /payroll/:id
   * Update an existing payroll group. Body: { employer_wallet, title, notification_email, members }
   */
  fastify.put("/payroll/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
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
        message: "employer_wallet, title, and at least one member are required",
      });
    }

    try {
      const payroll = await payrollService.updatePayroll(id, {
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

      return reply.send({ success: true, payroll });
    } catch (error: any) {
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
   * PATCH /payroll/:id/schedule
   * Update the frequency and schedule for a payroll group.
   * Body: { employer_wallet, frequency: 'weekly' | 'biweekly' | 'monthly' }
   */
  fastify.patch("/payroll/:id/schedule", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employer_wallet, frequency, escrow_tx_sig } = request.body as {
      employer_wallet?: string;
      frequency?: "weekly" | "biweekly" | "monthly";
      escrow_tx_sig?: string;
    };

    if (!employer_wallet || !frequency) {
      return reply.code(400).send({
        success: false,
        message: "employer_wallet and frequency are required",
      });
    }

    try {
      const cycle = await payrollService.schedulePayroll(id, employer_wallet, frequency, escrow_tx_sig);
      return { success: true, cycle };
    } catch (error: any) {
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
   * POST /payroll/cycles/:cycleId/sign
   * Employer signs off on a payment cycle (within 3-day window).
   * Body: { employer_wallet, tx_signature }
   */
  fastify.post("/payroll/cycles/:cycleId/sign", async (request, reply) => {
    const { cycleId } = request.params as { cycleId: string };
    const { employer_wallet, tx_signature } = request.body as { employer_wallet?: string; tx_signature?: string };

    if (!employer_wallet || !tx_signature) {
      return reply.code(400).send({ success: false, message: "employer_wallet and tx_signature are required" });
    }

    try {
      await payrollService.signCycle(cycleId, employer_wallet, tx_signature);
      return { success: true };
    } catch (error: any) {
      if (error instanceof PayrollInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  /**
   * POST /payroll/:id/cancel
   * Employer cancels the payroll and triggers refund.
   * Body: { employer_wallet, refund_tx_sig? }
   */
  fastify.post("/payroll/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employer_wallet, refund_tx_sig } = request.body as { employer_wallet?: string; refund_tx_sig?: string };

    if (!employer_wallet) {
      return reply.code(400).send({ success: false, message: "employer_wallet is required" });
    }

    try {
      await payrollService.cancelPayroll(id, employer_wallet, refund_tx_sig);
      return { success: true };
    } catch (error: any) {
      if (error instanceof PayrollInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  /**
   * GET /payroll/claimable?wallet=<worker_wallet>
   * Returns claimable payments for a worker.
   */
  fastify.get("/payroll/claimable", async (request, reply) => {
    const { wallet } = request.query as { wallet?: string };
    if (!wallet) return reply.code(400).send({ success: false, message: "wallet query param is required" });

    try {
      const claims = await payrollService.getClaimablePayments(wallet);
      return { success: true, claims };
    } catch (error: any) {
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  /**
   * POST /payroll/claims/:claimId/claim
   * Worker claims a released payment.
   * Body: { wallet_address, tx_signature }
   */
  fastify.post("/payroll/claims/:claimId/claim", async (request, reply) => {
    const { claimId } = request.params as { claimId: string };
    const { wallet_address, tx_signature } = request.body as { wallet_address?: string; tx_signature?: string };

    if (!wallet_address || !tx_signature) {
      return reply.code(400).send({ success: false, message: "wallet_address and tx_signature are required" });
    }

    try {
      await payrollService.claimPayment(claimId, wallet_address, tx_signature);
      return { success: true };
    } catch (error: any) {
      if (error instanceof PayrollInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  /**
   * POST /payroll/notify
   * Trigger 3-day pre-payout notifications (called by cron or manually).
   */
  fastify.post("/payroll/notify", async (request, reply) => {
    try {
      const count = await payrollService.sendPendingNotifications();
      return { success: true, notified: count };
    } catch (error: any) {
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  /**
   * POST /payroll/:id/execute
   * Trigger immediate group payment. Body: { employer_wallet }
   */
  fastify.post("/payroll/:id/execute", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employer_wallet } = request.body as { employer_wallet?: string };

    if (!employer_wallet) {
      return reply.code(400).send({
        success: false,
        message: "employer_wallet is required",
      });
    }

    try {
      await payrollService.executePayroll(id, employer_wallet);
      return { success: true };
    } catch (error: any) {
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
