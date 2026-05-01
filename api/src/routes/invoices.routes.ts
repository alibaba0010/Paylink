import { FastifyInstance } from "fastify";
import { DatabaseConnectionError } from "../db/supabase-client";
import { InvoiceService, InvoiceInputError } from "../services/invoices.service";

const invoiceService = new InvoiceService();

export default async function invoiceRoutes(fastify: FastifyInstance) {
  // POST /invoices
  fastify.post("/invoices", async (request, reply) => {
    const body = request.body as any;
    if (!body.creator_wallet || !body.title || !body.items?.length) {
      return reply.code(400).send({
        success: false,
        message: "creator_wallet, title, and at least one item are required",
      });
    }

    try {
      const invoice = await invoiceService.createInvoice(body);
      return reply.code(201).send({ success: true, invoice });
    } catch (error: any) {
      if (error instanceof InvoiceInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  // GET /invoices?creator_wallet=...
  fastify.get("/invoices", async (request, reply) => {
    const { creator_wallet } = request.query as { creator_wallet?: string };
    if (!creator_wallet) {
      return reply.code(400).send({ success: false, message: "creator_wallet is required" });
    }

    try {
      const invoices = await invoiceService.listInvoices(creator_wallet);
      return { success: true, invoices };
    } catch (error: any) {
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  // GET /invoices/:id_or_number
  fastify.get("/invoices/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      let invoice;
      if (id.startsWith('INV-')) {
        invoice = await invoiceService.getInvoiceByNumber(id);
      } else {
        invoice = await invoiceService.getInvoice(id);
      }
      
      if (!invoice) return reply.code(404).send({ success: false, message: "Invoice not found" });

      // Mark as viewed if it was sent
      if (invoice.status === "sent") {
        await invoiceService.markViewed(invoice.id);
        invoice.status = "viewed";
      }

      return { success: true, invoice };
    } catch (error: any) {
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  // PATCH /invoices/:id/status
  fastify.patch("/invoices/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { creator_wallet, status } = request.body as { creator_wallet?: string; status?: "cancelled" };

    if (!creator_wallet || status !== "cancelled") {
      return reply.code(400).send({ success: false, message: "creator_wallet is required and status must be 'cancelled'" });
    }

    try {
      await invoiceService.updateStatus(id, creator_wallet, status);
      return { success: true };
    } catch (error: any) {
      if (error instanceof InvoiceInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  // POST /invoices/:id/pay
  fastify.post("/invoices/:id/pay", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { payer_wallet, tx_signature } = request.body as { payer_wallet?: string; tx_signature?: string };

    if (!payer_wallet || !tx_signature) {
      return reply.code(400).send({ success: false, message: "payer_wallet and tx_signature are required" });
    }

    try {
      await invoiceService.payInvoice(id, payer_wallet, tx_signature);
      return { success: true };
    } catch (error: any) {
      if (error instanceof InvoiceInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  // GET /invoices/:id/comments
  fastify.get("/invoices/:id/comments", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const comments = await invoiceService.getComments(id);
      return { success: true, comments };
    } catch (error: any) {
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });

  // POST /invoices/:id/comments
  fastify.post("/invoices/:id/comments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    if (!body.author_role || !body.body) {
      return reply.code(400).send({ success: false, message: "author_role and body are required" });
    }

    try {
      const comment = await invoiceService.addComment({
        invoice_id: id,
        author_role: body.author_role,
        author_name: body.author_name,
        author_wallet: body.author_wallet,
        body: body.body,
      });
      return reply.code(201).send({ success: true, comment });
    } catch (error: any) {
      if (error instanceof InvoiceInputError) return reply.code(400).send({ success: false, message: error.message });
      if (error instanceof DatabaseConnectionError) return reply.code(503).send({ success: false, message: error.message });
      throw error;
    }
  });
}
