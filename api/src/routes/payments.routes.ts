import { FastifyInstance } from "fastify";
import { SolanaService } from "../services/solana.service";
import { supabase } from "../db/supabase-client";
import { PublicKey } from "@solana/web3.js";

export default async function paymentRoutes(fastify: FastifyInstance) {
  const solanaService = new SolanaService();

  // ── Single / multi-recipient direct payment initiate ─────────────────────
  /**
   * POST /payments/initiate
   * Build an unsigned direct-transfer transaction for one OR multiple recipients.
   *
   * Single mode:  { sender_pubkey, recipient_wallet, amount_usdc, memo?, link_id? }
   * Multi  mode:  { sender_pubkey, recipients: [{ wallet_address, amount_usdc, label?, memo? }] }
   */
  fastify.post("/payments/initiate", async (request, reply) => {
    const body = request.body as any;
    const { sender_pubkey, link_id, memo } = body;

    if (!sender_pubkey) {
      return reply
        .code(400)
        .send({ success: false, message: "sender_pubkey is required" });
    }

    // ── Multi-recipient mode ──────────────────────────────────────────────
    if (Array.isArray(body.recipients) && body.recipients.length > 0) {
      const recipients: {
        wallet_address: string;
        amount_usdc: number;
        label?: string;
        memo?: string;
      }[] = body.recipients;

      if (recipients.length > 20) {
        return reply.code(400).send({
          success: false,
          message: "Maximum 20 recipients per bulk payment",
        });
      }

      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        if (!r.wallet_address || !r.amount_usdc || r.amount_usdc <= 0) {
          return reply.code(400).send({
            success: false,
            message: `Recipient ${i + 1}: wallet_address and amount_usdc > 0 are required`,
          });
        }
        try {
          new PublicKey(r.wallet_address);
        } catch {
          return reply.code(400).send({
            success: false,
            message: `Recipient ${i + 1}: invalid Solana wallet address`,
          });
        }
      }

      // Build chunked bulk transactions (approx 10 transfers per tx)
      const txBase64Array = await solanaService.buildBulkDirectTransferTransactions(
        sender_pubkey,
        recipients.map(r => ({ wallet_address: r.wallet_address, amount_usdc: r.amount_usdc }))
      );

      return reply.send({ 
        success: true, 
        mode: "multi", 
        transactions: txBase64Array,
        recipients // Return the recipients back so frontend knows the mappings
      });
    }

    // ── Single-recipient mode ─────────────────────────────────────────────
    const { recipient_wallet, amount_usdc, use_escrow = false } = body;

    if (!recipient_wallet || !amount_usdc) {
      return reply.code(400).send({
        success: false,
        message: "recipient_wallet and amount_usdc are required",
      });
    }

    let txBase64: string;
    if (use_escrow) {
      txBase64 = await solanaService.buildDepositTransaction(
        sender_pubkey,
        recipient_wallet,
        amount_usdc,
        0,
      );
    } else {
      txBase64 = await solanaService.buildDirectTransferTransaction(
        sender_pubkey,
        recipient_wallet,
        amount_usdc,
      );
    }

    return reply.send({
      success: true,
      mode: "single",
      transaction: txBase64,
      link_id,
      memo,
    });
  });

  // ── Confirm single payment ────────────────────────────────────────────────
  /**
   * POST /payments/confirm
   * Record a confirmed single-payment transaction in the DB.
   */
  fastify.post("/payments/confirm", async (request, reply) => {
    const {
      signature,
      link_id,
      recipient_wallet,
      sender_wallet,
      amount_usdc,
      memo,
    } = request.body as any;

    if (!signature || !recipient_wallet || !sender_wallet) {
      return reply.code(400).send({
        success: false,
        message: "signature, sender_wallet, and recipient_wallet are required",
      });
    }

    // Look up recipient user (if registered on PayLink)
    const { data: recipientUser } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", recipient_wallet)
      .maybeSingle();

    // Resolve link id if provided
    let dbLinkId: string | null = null;
    if (link_id) {
      const { data: link } = await supabase
        .from("payment_links")
        .select("id")
        .eq("link_id", link_id)
        .maybeSingle();
      dbLinkId = link?.id ?? null;
    }

    const { error } = await supabase.from("payments").insert({
      link_id: dbLinkId,
      sender_wallet,
      recipient_id: recipientUser?.id ?? null,
      amount_usdc: Number(amount_usdc),
      memo: memo ?? null,
      tx_signature: signature,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      payment_type: "single",
    });

    if (error) {
      console.error("payments.confirm insert error:", error);
      // If it's just a duplicate signature, treat as success
      if (!error.code?.includes("23505")) {
        return reply.code(500).send({ success: false, message: error.message });
      }
    }

    // Update payment link stats if appli
    // cable
    if (dbLinkId && amount_usdc) {
      try {
        await supabase.rpc("increment_payment_link_stats", {
          p_link_id: dbLinkId,
          p_amount: Number(amount_usdc),
        });
      } catch (error) {
        console.error(
          "payments.confirm increment_payment_link_stats error:",
          error,
        );
      }
    }

    return reply.send({ success: true, signature });
  });

  // ── Confirm bulk / multi-recipient payment ────────────────────────────────
  /**
   * POST /payments/confirm-bulk
   * Record multiple confirmed recipient transactions from a bulk direct payment.
   * Body: { sender_wallet, recipients: [{ wallet_address, amount_usdc, signature, label?, memo? }] }
   */
  fastify.post("/payments/confirm-bulk", async (request, reply) => {
    const { sender_wallet, recipients, memo } = request.body as {
      sender_wallet: string;
      memo?: string;
      recipients: {
        wallet_address: string;
        amount_usdc: number;
        signature: string;
        label?: string;
        memo?: string;
      }[];
    };

    if (
      !sender_wallet ||
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return reply.code(400).send({
        success: false,
        message: "sender_wallet and recipients[] are required",
      });
    }

    const totalUsdc = recipients.reduce((s, r) => s + r.amount_usdc, 0);

    // Create a parent payment record for the bulk operation
    const { data: parentPayment, error: parentErr } = await supabase
      .from("payments")
      .insert({
        sender_wallet,
        recipient_id: null,
        amount_usdc: totalUsdc,
        memo: memo ?? null,
        tx_signature: `bulk_${Date.now()}`,
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        payment_type: "bulk_direct",
        recipient_count: recipients.length,
      })
      .select("id")
      .single();

    if (parentErr || !parentPayment) {
      return reply.code(500).send({
        success: false,
        message: parentErr?.message || "Failed to create bulk payment record",
      });
    }

    // Insert per-recipient rows
    const recipientRows = await Promise.all(
      recipients.map(async (r) => {
        const { data: user } = await supabase
          .from("users")
          .select("id")
          .eq("wallet_address", r.wallet_address)
          .maybeSingle();

        return {
          payment_id: parentPayment.id,
          recipient_id: user?.id ?? null,
          wallet_address: r.wallet_address,
          label: r.label ?? null,
          amount_usdc: r.amount_usdc,
          memo: r.memo ?? null,
          tx_signature: r.signature,
          status: "confirmed",
        };
      }),
    );

    const { error: bulkErr } = await supabase
      .from("direct_payment_recipients")
      .insert(recipientRows);

    if (bulkErr) {
      console.error("confirm-bulk insert error:", bulkErr);
      return reply.code(500).send({ success: false, message: bulkErr.message });
    }

    return reply.send({
      success: true,
      payment_id: parentPayment.id,
      recipient_count: recipients.length,
    });
  });

  // ── Fetch payment history ───────────────────────────────────────────────────
  /**
   * GET /payments/history
   * Fetch recent payments sent by or sent to a wallet
   */
  fastify.get("/payments/history", async (request, reply) => {
    const { wallet } = request.query as { wallet?: string };
    if (!wallet) {
      return reply.code(400).send({ success: false, message: "wallet is required" });
    }

    // Lookup user id to find received payments
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", wallet)
      .maybeSingle();

    let query = supabase
      .from("payments")
      .select(`
        id, amount_usdc, status, created_at, tx_signature, payment_type, recipient_count,
        sender_wallet,
        recipient:users!payments_recipient_id_fkey(username, display_name, wallet_address, icon_key)
      `)
      .order("created_at", { ascending: false })
      .limit(30);

    if (user?.id) {
      query = query.or(`sender_wallet.eq.${wallet},recipient_id.eq.${user.id}`);
    } else {
      query = query.eq("sender_wallet", wallet);
    }

    const { data, error } = await query;
    if (error) {
      console.error("fetch history error:", error);
      return reply.code(500).send({ success: false, message: error.message });
    }

    return reply.send({ success: true, payments: data });
  });
}
