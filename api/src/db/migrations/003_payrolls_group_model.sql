-- Migration 003: Group-based payroll model
-- Run in Supabase SQL editor AFTER migration 002

-- ── Payroll groups (one per employer per payroll run) ─────────────────────────
CREATE TABLE IF NOT EXISTS payroll_schedules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  frequency          TEXT,            -- NULL until step 2 scheduling
  next_run_at        TIMESTAMPTZ,     -- NULL until step 2 scheduling
  notification_email TEXT,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── Individual members inside a payroll group ─────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id     UUID REFERENCES payroll_schedules(id) ON DELETE CASCADE,
  worker_id      UUID REFERENCES users(id),  -- NULL when wallet-only (no PayLink account)
  wallet_address TEXT NOT NULL,              -- always stored (resolved or supplied directly)
  label          TEXT,                       -- display label for wallet-only rows
  amount_usdc    NUMERIC(18,6) NOT NULL,
  memo           TEXT,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payrolls_employer    ON payroll_schedules(employer_id);
CREATE INDEX IF NOT EXISTS idx_payroll_members_group ON payroll_members(payroll_id);
CREATE INDEX IF NOT EXISTS idx_payroll_members_worker ON payroll_members(worker_id);
