-- Migration 008: Hybrid cross-chain mirror support
-- Run in Supabase SQL editor AFTER migration 007
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cross_chain_payments
  ADD COLUMN IF NOT EXISTS settlement_strategy TEXT DEFAULT 'treasury_mirror',
  ADD COLUMN IF NOT EXISTS source_treasury_address TEXT,
  ADD COLUMN IF NOT EXISTS payout_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_payout_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN cross_chain_payments.status IS
  'pending | verified | processing_payout | completed | failed';

COMMENT ON COLUMN payments.payment_type IS
  'single | bulk_direct | scheduled | invoice | cross_chain';

CREATE INDEX IF NOT EXISTS idx_cross_chain_source_chain
  ON cross_chain_payments(source_chain);

-- Background treasury rebalancing queue. The direct CCTP implementation lives
-- in api/src/services/cctp and can be wired to this table when you automate
-- treasury settlement between source-chain liquidity and Solana liquidity.
CREATE TABLE IF NOT EXISTS cross_chain_rebalance_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_chain        TEXT NOT NULL,
  destination_chain   TEXT NOT NULL DEFAULT 'solana',
  amount_usdc         NUMERIC(18,6) NOT NULL,
  source_tx_hash      TEXT,
  dest_tx_signature   TEXT,
  status              TEXT DEFAULT 'pending', -- 'pending' | 'submitted' | 'completed' | 'failed'
  error_message       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cross_chain_rebalance_status
  ON cross_chain_rebalance_jobs(status);
