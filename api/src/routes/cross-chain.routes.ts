import { FastifyInstance } from "fastify";
import { DatabaseConnectionError } from "../db/supabase-client";
import { CrossChainService, CrossChainInputError, CrossChainLiquidityError } from "../services/cross-chain.service";

const crossChainService = new CrossChainService();

export default async function crossChainRoutes(fastify: FastifyInstance) {
  // POST /cross-chain/preflight
  fastify.post("/cross-chain/preflight", async (request, reply) => {
    const { amount_usdc } = request.body as any;

    try {
      const result = await crossChainService.getLiquidityStatus(Number(amount_usdc));
      if (!result.available) {
        return reply.code(503).send(result);
      }
      return reply.send(result);
    } catch (error: any) {
      if (error instanceof CrossChainInputError) {
        return reply.code(400).send({ success: false, message: error.message });
      }
      console.error("[cross-chain] /preflight error", {
        message: error.message || "Unknown error",
      });
      return reply.code(503).send({
        success: false,
        available: false,
        message: "Service unavailable at the moment, come back later.",
      });
    }
  });

  // POST /cross-chain/verify
  fastify.post("/cross-chain/verify", async (request, reply) => {
    const { source_chain, tx_hash, recipient_wallet, amount_usdc } = request.body as any;
    console.log("[cross-chain] /verify request", {
      source_chain,
      tx_hash,
      recipient_wallet,
      amount_usdc,
    });

    if (!source_chain || !tx_hash || !recipient_wallet || !amount_usdc) {
      console.warn("[cross-chain] /verify invalid request", {
        hasSourceChain: !!source_chain,
        hasTxHash: !!tx_hash,
        hasRecipientWallet: !!recipient_wallet,
        hasAmountUsdc: !!amount_usdc,
      });
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
      console.log("[cross-chain] /verify result", {
        tx_hash,
        status: result.status,
        hasDestTxSignature: "destTxSignature" in result && !!result.destTxSignature,
        message: "message" in result ? result.message : undefined,
      });
      return reply.send(result);
    } catch (error: any) {
      if (error instanceof CrossChainInputError) {
        console.warn("[cross-chain] /verify input error", {
          tx_hash,
          message: error.message,
        });
        return reply.code(400).send({ success: false, message: error.message });
      }
      if (error instanceof CrossChainLiquidityError) {
        console.warn("[cross-chain] /verify liquidity error", {
          tx_hash,
          message: error.message,
        });
        return reply.code(503).send({ success: false, message: error.message });
      }
      if (error instanceof DatabaseConnectionError) {
        console.error("[cross-chain] /verify database error", {
          tx_hash,
          message: error.message,
        });
        return reply.code(503).send({ success: false, message: error.message });
      }
      
      console.error("CrossChain Route Error:", error);
      return reply.code(500).send({ success: false, message: error.message });
    }
  });
}
