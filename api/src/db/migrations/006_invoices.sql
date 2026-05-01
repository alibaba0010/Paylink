-- Migration 006: Invoices with line items and comments
-- Run in Supabase SQL editor AFTER migration 005
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Invoices ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT UNIQUE NOT NULL,                     -- e.g. 'INV-a3f2'
  creator_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_email     TEXT,                                     -- optional payer contact
  payer_name      TEXT,                                     -- optional payer display name
  title           TEXT NOT NULL,
  description     TEXT,
  due_date        TIMESTAMPTZ,                              -- optional due date
  status          TEXT NOT NULL DEFAULT 'draft',            -- 'draft'|'sent'|'viewed'|'paid'|'cancelled'
  total_usdc      NUMERIC(18,6) NOT NULL DEFAULT 0,
  tx_signature    TEXT,                                     -- on-chain payment signature
  paid_at         TIMESTAMPTZ,
  paid_by_wallet  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_creator  ON invoices(creator_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number   ON invoices(invoice_number);

-- ── 2. Invoice line items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  quantity     NUMERIC NOT NULL DEFAULT 1,
  unit_price   NUMERIC(18,6) NOT NULL DEFAULT 0,
  amount_usdc  NUMERIC(18,6) NOT NULL DEFAULT 0,           -- qty × unit_price
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ── 3. Invoice comments (creator ↔ payer thread) ────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  author_role   TEXT NOT NULL DEFAULT 'payer',              -- 'creator' | 'payer'
  author_name   TEXT,
  author_wallet TEXT,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_comments_invoice ON invoice_comments(invoice_id);
