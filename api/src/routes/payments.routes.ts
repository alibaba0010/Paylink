import { FastifyInstance } from 'fastify';
import { SolanaService } from '../services/solana.service';

export default async function paymentRoutes(fastify: FastifyInstance) {
  const solanaService = new SolanaService();

  fastify.post('/payments/initiate', async (request, reply) => {
    const { link_id, sender_pubkey, recipient_wallet, amount_usdc, memo } = request.body as any;

    if (!sender_pubkey || !recipient_wallet || !amount_usdc) {
      return reply.code(400).send({
        success: false,
        message: 'sender_pubkey, recipient_wallet, and amount_usdc are required',
      });
    }

    const { use_escrow = true } = request.body as any;

    let txBase64: string;
    if (use_escrow) {
      txBase64 = await solanaService.buildDepositTransaction(
        sender_pubkey,
        recipient_wallet,
        amount_usdc,
        0
      );
    } else {
      txBase64 = await solanaService.buildDirectTransferTransaction(
        sender_pubkey,
        recipient_wallet,
        amount_usdc
      );
    }

    return {
      success: true,
      transaction: txBase64,
      link_id,
      memo,
    };
  });

  fastify.post('/payments/confirm', async (request, reply) => {
    const { signature, link_id, recipient_wallet } = request.body as any;
    // Scaffold: Confirm signed tx, update DB
    return { success: true, signature, link_id, recipient_wallet };
  });
}
