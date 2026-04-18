import { supabase, DatabaseConnectionError } from '../db/supabase-client';
import { PublicKey } from '@solana/web3.js';

export class PayrollInputError extends Error {}

export type PayrollFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface PayrollMember {
  id: string;
  payroll_id: string;
  worker_id: string | null;
  wallet_address: string;
  label: string | null;
  username: string | null;
  display_name: string | null;
  icon_key: string | null;
  amount_usdc: number;
  memo: string | null;
}

export interface Payroll {
  id: string;
  employer_id: string;
  title: string;
  frequency: PayrollFrequency | null;
  next_run_at: string | null;
  notification_email: string | null;
  is_active: boolean;
  member_count: number;
  total_usdc: number;
  members: PayrollMember[];
  created_at: string;
}

interface MemberInput {
  /** PayLink username — looked up to get wallet. Mutually exclusive with wallet_address. */
  username?: string;
  /** Raw Solana wallet address — used directly when the person has no PayLink account. */
  wallet_address?: string;
  /** Display label for wallet-only members */
  label?: string;
  amount_usdc: number;
  memo?: string;
}

export interface CreatePayrollInput {
  employer_wallet: string;
  title: string;
  notification_email?: string;
  members: MemberInput[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateWallet(addr: string, context = 'Wallet address'): string {
  try {
    return new PublicKey(addr.trim()).toBase58();
  } catch {
    throw new PayrollInputError(`${context} is not a valid Solana address`);
  }
}

function validateEmail(email: string) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) throw new PayrollInputError('Invalid notification email address');
}

// ── Service ───────────────────────────────────────────────────────────────────

export class PayrollService {
  /**
   * Create a named payroll group with one or more members in a single call.
   * Members can be identified by PayLink username OR by raw wallet address.
   * Frequency is NOT set at creation — that is a scheduling step done later.
   */
  async createPayroll(input: CreatePayrollInput): Promise<Payroll> {
    const employerWallet = validateWallet(input.employer_wallet, 'Employer wallet');

    if (!input.title || input.title.trim().length < 2) {
      throw new PayrollInputError('Payroll title must be at least 2 characters');
    }

    if (!input.members || input.members.length === 0) {
      throw new PayrollInputError('At least one member is required');
    }

    if (input.notification_email) {
      validateEmail(input.notification_email);
    }

    // Resolve employer
    const { data: employer, error: employerErr } = await supabase
      .from('users')
      .select('id')
      .eq('wallet_address', employerWallet)
      .single();

    if (employerErr || !employer) {
      throw new PayrollInputError('Employer wallet is not registered on PayLink');
    }

    // Resolve each member
    const resolvedMembers: {
      worker_id: string | null;
      wallet_address: string;
      label: string | null;
      amount_usdc: number;
      memo: string | null;
    }[] = [];

    for (let i = 0; i < input.members.length; i++) {
      const m = input.members[i];
      const idx = i + 1;

      if (m.amount_usdc <= 0) {
        throw new PayrollInputError(`Member ${idx}: amount must be greater than 0`);
      }

      if (m.username) {
        // Look up by PayLink username
        const uname = m.username.trim().toLowerCase().replace(/^@/, '');
        const { data: worker } = await supabase
          .from('users')
          .select('id, wallet_address')
          .eq('username', uname)
          .single();

        if (!worker) {
          throw new PayrollInputError(`Member ${idx}: "@${uname}" is not registered on PayLink`);
        }

        if (worker.id === employer.id) {
          throw new PayrollInputError(`Member ${idx}: you cannot add yourself as a payroll member`);
        }

        resolvedMembers.push({
          worker_id: worker.id,
          wallet_address: worker.wallet_address,
          label: null,
          amount_usdc: m.amount_usdc,
          memo: m.memo || null,
        });
      } else if (m.wallet_address) {
        // Direct wallet — validate it
        const wallet = validateWallet(m.wallet_address, `Member ${idx} wallet`);

        if (wallet === employerWallet) {
          throw new PayrollInputError(`Member ${idx}: you cannot add yourself as a payroll member`);
        }

        // Optionally check if there's a PayLink user with this wallet
        const { data: worker } = await supabase
          .from('users')
          .select('id, wallet_address')
          .eq('wallet_address', wallet)
          .maybeSingle();

        resolvedMembers.push({
          worker_id: worker?.id ?? null,
          wallet_address: wallet,
          label: m.label?.trim() || null,
          amount_usdc: m.amount_usdc,
          memo: m.memo || null,
        });
      } else {
        throw new PayrollInputError(`Member ${idx}: either username or wallet_address is required`);
      }
    }

    // Create the payroll group
    const { data: payroll, error: payrollErr } = await supabase
      .from('payrolls')
      .insert({
        employer_id: employer.id,
        title: input.title.trim(),
        notification_email: input.notification_email || null,
        is_active: true,
      })
      .select('id, employer_id, title, frequency, next_run_at, notification_email, is_active, created_at')
      .single();

    if (payrollErr || !payroll) {
      throw new DatabaseConnectionError(payrollErr?.message || 'Failed to create payroll');
    }

    // Insert all members
    const memberRows = resolvedMembers.map((m) => ({
      payroll_id: payroll.id,
      ...m,
    }));

    const { data: members, error: membersErr } = await supabase
      .from('payroll_members')
      .insert(memberRows)
      .select('id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo');

    if (membersErr) {
      // Roll back the payroll group if member insert fails
      await supabase.from('payrolls').delete().eq('id', payroll.id);
      throw new DatabaseConnectionError(membersErr.message || 'Failed to add payroll members');
    }

    // Enrich members with user details
    const enriched = await this.enrichMembers(members || []);

    return this.toPayroll(payroll, enriched);
  }

  /**
   * List all active payrolls created by an employer, with member count + total.
   */
  async listPayrolls(employerWallet: string): Promise<Payroll[]> {
    const wallet = validateWallet(employerWallet);

    const { data: employer } = await supabase
      .from('users')
      .select('id')
      .eq('wallet_address', wallet)
      .single();

    if (!employer) return [];

    const { data, error } = await supabase
      .from('payrolls')
      .select(`
        id, employer_id, title, frequency, next_run_at, notification_email, is_active, created_at,
        payroll_members(id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo)
      `)
      .eq('employer_id', employer.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseConnectionError(error.message || 'Failed to fetch payrolls');
    }

    const results: Payroll[] = [];
    for (const row of data || []) {
      const enriched = await this.enrichMembers(row.payroll_members || []);
      results.push(this.toPayroll(row, enriched));
    }
    return results;
  }

  /**
   * Deactivate an entire payroll group.
   */
  async deactivatePayroll(payrollId: string, employerWallet: string): Promise<void> {
    const wallet = validateWallet(employerWallet);

    const { data: employer } = await supabase
      .from('users')
      .select('id')
      .eq('wallet_address', wallet)
      .single();

    if (!employer) throw new PayrollInputError('Employer wallet not found');

    const { error } = await supabase
      .from('payrolls')
      .update({ is_active: false })
      .eq('id', payrollId)
      .eq('employer_id', employer.id);

    if (error) throw new DatabaseConnectionError(error.message || 'Failed to deactivate payroll');
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async enrichMembers(members: any[]): Promise<PayrollMember[]> {
    const workerIds = members
      .map((m) => m.worker_id)
      .filter((id): id is string => !!id);

    let userMap: Record<string, { username: string; display_name: string; icon_key: string | null }> = {};

    if (workerIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, username, display_name, icon_key')
        .in('id', workerIds);

      for (const u of users || []) {
        userMap[u.id] = { username: u.username, display_name: u.display_name, icon_key: u.icon_key };
      }
    }

    return members.map((m) => {
      const user = m.worker_id ? userMap[m.worker_id] : null;
      return {
        id: m.id,
        payroll_id: m.payroll_id,
        worker_id: m.worker_id ?? null,
        wallet_address: m.wallet_address,
        label: m.label ?? null,
        username: user?.username ?? null,
        display_name: user?.display_name ?? null,
        icon_key: user?.icon_key ?? null,
        amount_usdc: Number(m.amount_usdc),
        memo: m.memo ?? null,
      };
    });
  }

  private toPayroll(row: any, members: PayrollMember[]): Payroll {
    const total = members.reduce((sum, m) => sum + m.amount_usdc, 0);
    return {
      id: row.id,
      employer_id: row.employer_id,
      title: row.title,
      frequency: row.frequency ?? null,
      next_run_at: row.next_run_at ?? null,
      notification_email: row.notification_email ?? null,
      is_active: row.is_active,
      member_count: members.length,
      total_usdc: total,
      members,
      created_at: row.created_at,
    };
  }
}
