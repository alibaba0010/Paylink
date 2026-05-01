-- Migration 007: Cross-chain payments support
-- Run in Supabase SQL editor AFTER migration 006
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cross_chain_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_chain        TEXT NOT NULL DEFAULT 'sepolia',
  source_tx_hash      TEXT UNIQUE NOT NULL,
  sender_address      TEXT,
  recipient_wallet    TEXT NOT NULL,
  amount_usdc         NUMERIC(18,6) NOT NULL,
  dest_tx_signature   TEXT,
  status              TEXT DEFAULT 'pending', -- 'pending' | 'verified' | 'completed' | 'failed'
  error_message       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cross_chain_status ON cross_chain_payments(status);
CREATE INDEX IF NOT EXISTS idx_cross_chain_recipient ON cross_chain_payments(recipient_wallet);
