import { FastifyInstance } from "fastify";
import { DatabaseConnectionError } from "../db/supabase-client";
import { CrossChainService, CrossChainInputError } from "../services/cross-chain.service";

const crossChainService = new CrossChainService();

export default async function crossChainRoutes(fastify: FastifyInstance) {
  // POST /cross-chain/verify
  fastify.post("/cross-chain/verify", async (request, reply) => {
    const { source_chain, tx_hash, recipient_wallet, amount_usdc } = request.body as any;

    if (!source_chain || !tx_hash || !recipient_wallet || !amount_usdc) {
      return reply.code(400).send({
        success: false,
        message: "source_chain, tx_hash, recipient_wallet, amount_usdc are required",
      });
    }

    try {
      const result = await crossChainService.verifyAndFulfill(
        source_chain,
        tx_hash,
        recipient_wallet,
        Number(amount_usdc)
      );
      return reply.send(result);
    } catch (error: any) {
      if (error instanceof CrossChainInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      
      console.error("CrossChain Route Error:", error);
      return reply.code(500).send({ success: false, message: error.message });
    }
  });
}
