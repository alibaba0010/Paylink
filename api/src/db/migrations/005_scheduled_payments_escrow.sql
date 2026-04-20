-- Migration 005: Fix payroll_schedules schema + add scheduled-payment escrow support
-- Run in Supabase SQL editor AFTER migration 004
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Patch payroll_schedules: add missing columns ──────────────────────────
--   (migration 003 created the table but omitted amount_usdc, memo, worker_id,
--    frequency, next_run_at, and escrow tracking columns)

ALTER TABLE payroll_schedules
  ADD COLUMN IF NOT EXISTS frequency          TEXT,         -- 'weekly' | 'biweekly' | 'monthly'
  ADD COLUMN IF NOT EXISTS next_run_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escrow_tx_sig      TEXT,         -- on-chain deposit signature
  ADD COLUMN IF NOT EXISTS escrow_funded      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escrow_amount_usdc NUMERIC(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ,  -- set when employer cancels
  ADD COLUMN IF NOT EXISTS refund_tx_sig      TEXT;         -- on-chain refund signature

-- ── 2. Add missing index that schema.sql references ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_payroll_next_run
  ON payroll_schedules(next_run_at)
  WHERE is_active = TRUE;

-- ── 3. scheduled_payment_cycles — one row per payout cycle ───────────────────
--   Tracks each payout cycle independently.  The employer must "sign off" up to
--   3 days before the due date.  Workers can claim on or after due_at.

CREATE TABLE IF NOT EXISTS scheduled_payment_cycles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id      UUID NOT NULL REFERENCES payroll_schedules(id) ON DELETE CASCADE,
  cycle_number    INTEGER NOT NULL DEFAULT 1,           -- 1-based cycle counter
  due_at          TIMESTAMPTZ NOT NULL,                 -- when recipients can claim
  sign_open_at    TIMESTAMPTZ NOT NULL,                 -- due_at - 3 days (employer sign window opens)
  employer_signed BOOLEAN DEFAULT FALSE,
  signed_at       TIMESTAMPTZ,                          -- when employer signed
  tx_signature    TEXT,                                 -- on-chain signature for this cycle
  status          TEXT DEFAULT 'pending',               -- 'pending'|'signed'|'released'|'cancelled'
  notified_at     TIMESTAMPTZ,                          -- when 3-day notification was sent
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cycles_payroll    ON scheduled_payment_cycles(payroll_id);
CREATE INDEX IF NOT EXISTS idx_cycles_due        ON scheduled_payment_cycles(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cycles_sign_open  ON scheduled_payment_cycles(sign_open_at) WHERE employer_signed = FALSE;

-- ── 4. scheduled_payment_claims — per-recipient claim tracking ────────────────
CREATE TABLE IF NOT EXISTS scheduled_payment_claims (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id     UUID NOT NULL REFERENCES scheduled_payment_cycles(id) ON DELETE CASCADE,
  payroll_id   UUID NOT NULL REFERENCES payroll_schedules(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES payroll_members(id) ON DELETE SET NULL,
  worker_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  amount_usdc  NUMERIC(18,6) NOT NULL,
  status       TEXT DEFAULT 'pending',              -- 'pending'|'claimable'|'claimed'|'cancelled'
  claim_tx_sig TEXT,
  claimable_at TIMESTAMPTZ NOT NULL,               -- same as cycle.due_at
  claimed_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_cycle    ON scheduled_payment_claims(cycle_id);
CREATE INDEX IF NOT EXISTS idx_claims_worker   ON scheduled_payment_claims(worker_id) WHERE status = 'claimable';
CREATE INDEX IF NOT EXISTS idx_claims_wallet   ON scheduled_payment_claims(wallet_address) WHERE status = 'claimable';

-- ── 5. direct_payment_recipients — multi-recipient direct payments ────────────
--   One row per recipient when the employer does a direct bulk payout.

CREATE TABLE IF NOT EXISTS direct_payment_recipients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  recipient_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  label          TEXT,
  amount_usdc    NUMERIC(18,6) NOT NULL,
  memo           TEXT,
  tx_signature   TEXT,                              -- Cannot be unique because a bulk tx pays multiple recipients
  status         TEXT DEFAULT 'pending',            -- 'pending'|'confirmed'|'failed'
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_payment   ON direct_payment_recipients(payment_id);
CREATE INDEX IF NOT EXISTS idx_direct_recipient ON direct_payment_recipients(recipient_id);

-- Drop the unique constraint if it was already created by a previous run
ALTER TABLE direct_payment_recipients DROP CONSTRAINT IF EXISTS direct_payment_recipients_tx_signature_key;

-- ── 6. payments table: add batch_id + type fields (if missing) ───────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'single',  -- 'single'|'bulk_direct'|'scheduled'
  ADD COLUMN IF NOT EXISTS payroll_id   UUID REFERENCES payroll_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_id     UUID REFERENCES scheduled_payment_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_count INTEGER DEFAULT 1,
  DROP COLUMN IF EXISTS frequency,
  DROP COLUMN IF EXISTS next_run_at;
