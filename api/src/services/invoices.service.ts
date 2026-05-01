import { supabase, DatabaseConnectionError } from "../db/supabase-client";
import { PublicKey } from "@solana/web3.js";

export class InvoiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceInputError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount_usdc: number;
  created_at: string;
}

export interface InvoiceComment {
  id: string;
  invoice_id: string;
  author_role: "creator" | "payer";
  author_name: string | null;
  author_wallet: string | null;
  body: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  creator_id: string;
  payer_email: string | null;
  payer_name: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "draft" | "sent" | "viewed" | "paid" | "cancelled";
  total_usdc: number;
  tx_signature: string | null;
  paid_at: string | null;
  paid_by_wallet: string | null;
  created_at: string;
  items: InvoiceItem[];
  comments: InvoiceComment[];
  creator?: {
    id: string;
    username: string;
    display_name: string;
    wallet_address: string;
    icon_key: string;
  };
}

export interface CreateInvoiceInput {
  creator_wallet: string;
  title: string;
  description?: string;
  payer_email?: string;
  payer_name?: string;
  due_date?: string;
  items: {
    description: string;
    quantity: number;
    unit_price: number;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function validateWallet(addr: string, ctx = "Wallet address"): string {
  try {
    return new PublicKey(addr.trim()).toBase58();
  } catch {
    throw new InvoiceInputError(`${ctx} is not a valid Solana address`);
  }
}

function generateInvoiceNumber(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `INV-${suffix}`;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class InvoiceService {

  /** Create a new invoice with line items. */
  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    const wallet = validateWallet(input.creator_wallet, "Creator wallet");

    if (!input.title || input.title.trim().length < 2)
      throw new InvoiceInputError("Invoice title must be at least 2 characters");
    if (!input.items || input.items.length === 0)
      throw new InvoiceInputError("At least one line item is required");

    // Validate line items
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (!item.description?.trim())
        throw new InvoiceInputError(`Item ${i + 1}: description is required`);
      if (item.quantity <= 0)
        throw new InvoiceInputError(`Item ${i + 1}: quantity must be > 0`);
      if (item.unit_price < 0)
        throw new InvoiceInputError(`Item ${i + 1}: unit price cannot be negative`);
    }

    const { data: creator, error: creatorErr } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (creatorErr || !creator)
      throw new InvoiceInputError("Creator wallet is not registered on PayLink");

    const totalUsdc = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const invoiceNumber = generateInvoiceNumber();

    // Insert invoice
    const { data: invoice, error: invoiceErr } = await supabase
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        creator_id: creator.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        payer_email: input.payer_email?.trim() || null,
        payer_name: input.payer_name?.trim() || null,
        due_date: input.due_date || null,
        status: "sent",
        total_usdc: totalUsdc,
      })
      .select("*")
      .single();

    if (invoiceErr || !invoice)
      throw new DatabaseConnectionError(invoiceErr?.message || "Failed to create invoice");

    // Insert line items
    const itemRows = input.items.map((item) => ({
      invoice_id: invoice.id,
      description: item.description.trim(),
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount_usdc: item.quantity * item.unit_price,
    }));

    const { data: items, error: itemsErr } = await supabase
      .from("invoice_items")
      .insert(itemRows)
      .select("*");

    if (itemsErr) {
      // Rollback: delete the invoice
      await supabase.from("invoices").delete().eq("id", invoice.id);
      throw new DatabaseConnectionError(itemsErr.message || "Failed to add invoice items");
    }

    return {
      ...invoice,
      total_usdc: Number(invoice.total_usdc),
      items: (items || []).map(this.normalizeItem),
      comments: [],
    };
  }

  /** List invoices for a creator. */
  async listInvoices(creatorWallet: string): Promise<Invoice[]> {
    const wallet = validateWallet(creatorWallet);
    const { data: creator } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!creator) return [];

    const { data, error } = await supabase
      .from("invoices")
      .select(`
        *,
        invoice_items(*),
        invoice_comments(*)
      `)
      .eq("creator_id", creator.id)
      .order("created_at", { ascending: false });

    if (error)
      throw new DatabaseConnectionError(error.message || "Failed to fetch invoices");

    return (data || []).map((row: any) => ({
      ...row,
      total_usdc: Number(row.total_usdc),
      items: (row.invoice_items || []).map(this.normalizeItem),
      comments: row.invoice_comments || [],
    }));
  }

  /** Get a single invoice by ID (public — used for payer view). */
  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    const { data, error } = await supabase
      .from("invoices")
      .select(`
        *,
        invoice_items(*),
        invoice_comments(*),
        creator:users!invoices_creator_id_fkey(id, username, display_name, wallet_address, icon_key)
      `)
      .eq("id", invoiceId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new DatabaseConnectionError(error.message);
    }

    return {
      ...data,
      total_usdc: Number(data.total_usdc),
      items: (data.invoice_items || []).map(this.normalizeItem),
      comments: data.invoice_comments || [],
      creator: data.creator || undefined,
    };
  }

  /** Get a single invoice by invoice_number (public — used for payer view). */
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null> {
    const { data, error } = await supabase
      .from("invoices")
      .select(`
        *,
        invoice_items(*),
        invoice_comments(*),
        creator:users!invoices_creator_id_fkey(id, username, display_name, wallet_address, icon_key)
      `)
      .eq("invoice_number", invoiceNumber)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new DatabaseConnectionError(error.message);
    }

    return {
      ...data,
      total_usdc: Number(data.total_usdc),
      items: (data.invoice_items || []).map(this.normalizeItem),
      comments: data.invoice_comments || [],
      creator: data.creator || undefined,
    };
  }

  /** Mark invoice as viewed (when payer opens). */
  async markViewed(invoiceId: string): Promise<void> {
    await supabase
      .from("invoices")
      .update({ status: "viewed" })
      .eq("id", invoiceId)
      .in("status", ["sent"]); // only upgrade from sent → viewed
  }

  /** Update invoice status (cancel, etc.). */
  async updateStatus(
    invoiceId: string,
    creatorWallet: string,
    status: "cancelled",
  ): Promise<void> {
    const wallet = validateWallet(creatorWallet);
    const { data: creator } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!creator) throw new InvoiceInputError("Creator wallet not found");

    const { data: inv } = await supabase
      .from("invoices").select("id, status, creator_id")
      .eq("id", invoiceId).single();
    if (!inv) throw new InvoiceInputError("Invoice not found");
    if (inv.creator_id !== creator.id)
      throw new InvoiceInputError("Access denied");
    if (inv.status === "paid")
      throw new InvoiceInputError("Cannot cancel a paid invoice");

    const { error } = await supabase
      .from("invoices")
      .update({ status })
      .eq("id", invoiceId);
    if (error) throw new DatabaseConnectionError(error.message);
  }

  /** Record payment on an invoice. */
  async payInvoice(
    invoiceId: string,
    payerWallet: string,
    txSignature: string,
  ): Promise<void> {
    const wallet = validateWallet(payerWallet, "Payer wallet");

    const { data: inv } = await supabase
      .from("invoices").select("id, status, total_usdc, creator_id")
      .eq("id", invoiceId).single();
    if (!inv) throw new InvoiceInputError("Invoice not found");
    if (inv.status === "paid")
      throw new InvoiceInputError("Invoice is already paid");
    if (inv.status === "cancelled")
      throw new InvoiceInputError("Invoice has been cancelled");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "paid",
        tx_signature: txSignature,
        paid_at: now,
        paid_by_wallet: wallet,
      })
      .eq("id", invoiceId);
    if (error) throw new DatabaseConnectionError(error.message);

    // Also record in payments table for history
    const { data: creator } = await supabase
      .from("users").select("id, wallet_address")
      .eq("id", inv.creator_id).single();

    if (creator) {
      await supabase.from("payments").insert({
        sender_wallet: wallet,
        recipient_id: creator.id,
        amount_usdc: Number(inv.total_usdc),
        tx_signature: txSignature,
        status: "confirmed",
        payment_type: "invoice",
        confirmed_at: now,
        memo: `Invoice payment`,
      });
    }
  }

  /** Get comments for an invoice. */
  async getComments(invoiceId: string): Promise<InvoiceComment[]> {
    const { data, error } = await supabase
      .from("invoice_comments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });
    if (error) throw new DatabaseConnectionError(error.message);
    return data || [];
  }

  /** Add a comment to an invoice. */
  async addComment(input: {
    invoice_id: string;
    author_role: "creator" | "payer";
    author_name?: string;
    author_wallet?: string;
    body: string;
  }): Promise<InvoiceComment> {
    if (!input.body?.trim())
      throw new InvoiceInputError("Comment body is required");

    // Verify invoice exists
    const { data: inv } = await supabase
      .from("invoices").select("id, status")
      .eq("id", input.invoice_id).single();
    if (!inv) throw new InvoiceInputError("Invoice not found");

    const { data, error } = await supabase
      .from("invoice_comments")
      .insert({
        invoice_id: input.invoice_id,
        author_role: input.author_role,
        author_name: input.author_name?.trim() || null,
        author_wallet: input.author_wallet || null,
        body: input.body.trim(),
      })
      .select("*")
      .single();

    if (error || !data)
      throw new DatabaseConnectionError(error?.message || "Failed to add comment");

    return data;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private normalizeItem(item: any): InvoiceItem {
    return {
      ...item,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      amount_usdc: Number(item.amount_usdc),
    };
  }
}
