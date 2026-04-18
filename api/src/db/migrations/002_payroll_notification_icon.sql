-- Migration: Add notification_email to payroll_schedules
-- Run this in your Supabase SQL editor

ALTER TABLE payroll_schedules
  ADD COLUMN IF NOT EXISTS notification_email TEXT;

-- Also add icon_url to users table for the onboarding icon picker
-- (avatar_url already exists; icon_url stores the chosen icon key)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS icon_key TEXT DEFAULT 'zap';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payroll_employer ON payroll_schedules(employer_id);
CREATE INDEX IF NOT EXISTS idx_payroll_worker   ON payroll_schedules(worker_id);
