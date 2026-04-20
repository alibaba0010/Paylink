-- ── Users (workers AND employers) ─────────────────────────────────────────────
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT UNIQUE NOT NULL,
  display_name   TEXT NOT NULL,
  email          TEXT UNIQUE,
  wallet_address TEXT UNIQUE NOT NULL,
  avatar_url     TEXT,
  bio            TEXT,
  role           TEXT DEFAULT 'worker',   -- 'worker' | 'employer' | 'both'
  twitter        TEXT,
  github         TEXT,
  linkedin       TEXT,
  is_verified    BOOLEAN DEFAULT FALSE,
  -- Bank details for off-ramp
  bank_code      TEXT,
  bank_account   TEXT,
  bank_name      TEXT,
  -- Aggregated stats (updated on each payment)
  total_received NUMERIC(18,6) DEFAULT 0,
  total_payments INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payment Links ──────────────────────────────────────────────────────────────
CREATE TABLE payment_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      TEXT UNIQUE NOT NULL,           -- e.g. 'inv_abc123'
  owner_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  link_type    TEXT NOT NULL,                  -- 'personal'|'invoice'|'product'|'recurring'|'donation'
  title        TEXT,
  description  TEXT,
  amount_usdc  NUMERIC(18,6),                  -- NULL = open amount (sender chooses)
  memo         TEXT,
  redirect_url TEXT,                           -- optional redirect after payment
  icon_key     TEXT DEFAULT 'zap',
  view_count   INTEGER DEFAULT 0,
  is_active    BOOLEAN DEFAULT TRUE,
  is_archived  BOOLEAN DEFAULT FALSE,
  on_chain_pda TEXT,                           -- Solana PDA address
  total_received NUMERIC(18,6) DEFAULT 0,
  payment_count  INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payments (individual transactions) ────────────────────────────────────────
CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id          UUID REFERENCES payment_links(id),
  sender_wallet    TEXT NOT NULL,
  recipient_id     UUID REFERENCES users(id),
  amount_usdc      NUMERIC(18,6) NOT NULL,
  memo             TEXT,
  tx_signature     TEXT UNIQUE,
  status           TEXT DEFAULT 'pending',   -- 'pending'|'confirmed'|'failed'
  payment_type     TEXT DEFAULT 'single',    -- 'single'|'bulk_direct'|'scheduled'
  recipient_count  INTEGER DEFAULT 1,
  payroll_id       UUID,                     -- FK added after payroll_schedules created
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at     TIMESTAMPTZ
);

-- ── Payroll groups and Individual schedules ──────────────────────────────────
CREATE TABLE payroll_schedules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  worker_id          UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for groups
  title              TEXT NOT NULL,
  amount_usdc        NUMERIC(18,6) DEFAULT 0,
  memo               TEXT,
  notification_email TEXT,
  frequency          TEXT,            -- 'weekly' | 'biweekly' | 'monthly' (NULL until scheduled)
  next_run_at        TIMESTAMPTZ,
  is_active          BOOLEAN DEFAULT TRUE,
  -- Escrow tracking
  escrow_funded      BOOLEAN DEFAULT FALSE,
  escrow_amount_usdc NUMERIC(18,6) DEFAULT 0,
  escrow_tx_sig      TEXT,
  cancelled_at       TIMESTAMPTZ,
  refund_tx_sig      TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── Individual members inside a payroll group ─────────────────────────────────
CREATE TABLE payroll_members (
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

-- ── Off-Ramp Requests ─────────────────────────────────────────────────────────
CREATE TABLE offramp_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id),
  amount_usdc    NUMERIC(18,6) NOT NULL,
  amount_ngn     NUMERIC(18,2),
  rate_used      NUMERIC(10,4),
  fee_usdc       NUMERIC(18,6),
  bank_code      TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name   TEXT NOT NULL,
  provider_ref   TEXT UNIQUE,
  provider       TEXT DEFAULT 'p2p_bridge',
  status         TEXT DEFAULT 'pending',       -- 'pending'|'processing'|'completed'|'failed'
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  settled_at     TIMESTAMPTZ
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_payments_recipient    ON payments(recipient_id);
CREATE INDEX idx_payments_status       ON payments(status);
CREATE INDEX idx_payrolls_employer     ON payroll_schedules(employer_id);
CREATE INDEX idx_payroll_next_run      ON payroll_schedules(next_run_at) WHERE is_active = TRUE AND next_run_at IS NOT NULL;
CREATE INDEX idx_payroll_members_group ON payroll_members(payroll_id);
CREATE INDEX idx_offramp_user          ON offramp_requests(user_id);
CREATE INDEX idx_payment_links_owner   ON payment_links(owner_id);
