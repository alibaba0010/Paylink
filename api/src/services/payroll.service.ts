import { supabase, DatabaseConnectionError } from "../db/supabase-client";
import { PublicKey } from "@solana/web3.js";

export class PayrollInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollInputError";
  }
}

export type PayrollFrequency = "weekly" | "biweekly" | "monthly";

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
  worker_id: string | null; // NULL for groups
  title: string;
  notification_email: string | null;
  is_active: boolean;
  memo: string | null;
  member_count: number;
  total_usdc: number;
  members: PayrollMember[];
  frequency: PayrollFrequency | null;
  next_run_at: string | null;
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

function validateWallet(addr: string, context = "Wallet address"): string {
  try {
    return new PublicKey(addr.trim()).toBase58();
  } catch {
    throw new PayrollInputError(`${context} is not a valid Solana address`);
  }
}

function validateEmail(email: string) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email))
    throw new PayrollInputError("Invalid notification email address");
}

// ── Service ───────────────────────────────────────────────────────────────────

export class PayrollService {
  /**
   * Create a named payroll group with one or more members in a single call.
   * Members can be identified by PayLink username OR by raw wallet address.
   * Frequency is NOT set at creation — that is a scheduling step done later.
   */
  async createPayroll(input: CreatePayrollInput): Promise<Payroll> {
    const employerWallet = validateWallet(
      input.employer_wallet,
      "Employer wallet",
    );

    if (!input.title || input.title.trim().length < 2) {
      throw new PayrollInputError(
        "Payroll title must be at least 2 characters",
      );
    }

    if (!input.members || input.members.length === 0) {
      throw new PayrollInputError("At least one member is required");
    }

    if (input.notification_email) {
      validateEmail(input.notification_email);
    }

    // Resolve employer
    const { data: employer, error: employerErr } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", employerWallet)
      .single();

    if (employerErr || !employer) {
      throw new PayrollInputError(
        "Employer wallet is not registered on PayLink",
      );
    }

    const resolvedMembers = await this.resolveMembers(input.members, employer.id, employerWallet);

    // Calculate total
    const totalUsdc = resolvedMembers.reduce((sum, m) => sum + m.amount_usdc, 0);

    // Create the payroll group
    const { data: payroll, error: payrollErr } = await supabase
      .from("payroll_schedules")
      .insert({
        employer_id: employer.id,
        title: input.title.trim(),
        notification_email: input.notification_email || null,
        is_active: true,
        amount_usdc: totalUsdc,
      })
      .select(
        "id, employer_id, worker_id, title, notification_email, is_active, amount_usdc, memo, created_at",
      )
      .single();

    if (payrollErr || !payroll) {
      throw new DatabaseConnectionError(
        payrollErr?.message || "Failed to create payroll",
      );
    }

    // Insert all members
    const memberRows = resolvedMembers.map((m) => ({
      payroll_id: payroll.id,
      ...m,
    }));

    const { data: members, error: membersErr } = await supabase
      .from("payroll_members")
      .insert(memberRows)
      .select(
        "id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo",
      );

    if (membersErr) {
      // Roll back the payroll group if member insert fails
      await supabase.from("payroll_schedules").delete().eq("id", payroll.id);
      throw new DatabaseConnectionError(
        membersErr.message || "Failed to add payroll members",
      );
    }

    // Enrich members with user details
    const enriched = await this.enrichMembers(members || []);

    return this.toPayroll(payroll, enriched);
  }

  /**
   * List all active payroll_schedules created by an employer, with member count + total.
   */
  async listPayrolls(employerWallet: string): Promise<Payroll[]> {
    const wallet = validateWallet(employerWallet);

    const { data: employer } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", wallet)
      .single();

    if (!employer) return [];

    const { data, error } = await supabase
      .from("payroll_schedules")
      .select(
        `
        id, employer_id, title, notification_email, is_active, created_at,
        payroll_members(id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo)
      `,
      )
      .eq("employer_id", employer.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error in listPayrolls:", error);
      throw new DatabaseConnectionError(
        error.message || "Failed to fetch payroll_schedules",
      );
    }

    const results: Payroll[] = [];
    for (const row of data || []) {
      const enriched = await this.enrichMembers(row.payroll_members || []);
      results.push(this.toPayroll(row, enriched));
    }
    return results;
  }

  /**
   * Update an existing payroll group.
   * This replaces the entire member list and updates metadata.
   */
  async updatePayroll(id: string, input: CreatePayrollInput): Promise<Payroll> {
    const employerWallet = validateWallet(input.employer_wallet, "Employer wallet");

    const { data: employer } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", employerWallet)
      .single();

    if (!employer) throw new PayrollInputError("Employer wallet not found");

    // Verify ownership and existence
    const { data: existing } = await supabase
      .from("payroll_schedules")
      .select("id")
      .eq("id", id)
      .eq("employer_id", employer.id)
      .single();

    if (!existing) throw new PayrollInputError("Payroll group not found or access denied");

    if (input.notification_email) validateEmail(input.notification_email);

    const resolvedMembers = await this.resolveMembers(input.members, employer.id, employerWallet);
    const totalUsdc = resolvedMembers.reduce((sum, m) => sum + m.amount_usdc, 0);

    // Update the group
    const { data: payroll, error: payrollErr } = await supabase
      .from("payroll_schedules")
      .update({
        title: input.title.trim(),
        notification_email: input.notification_email || null,
        amount_usdc: totalUsdc,
      })
      .eq("id", id)
      .select("id, employer_id, worker_id, title, notification_email, is_active, amount_usdc, memo, created_at")
      .single();

    if (payrollErr || !payroll) {
      throw new DatabaseConnectionError(payrollErr?.message || "Failed to update payroll");
    }

    // Replace members: delete old ones and insert new ones
    // We do this in a single operation block (though not a strict SQL transaction here, Supabase batches inserts)
    await supabase.from("payroll_members").delete().eq("payroll_id", id);

    const memberRows = resolvedMembers.map((m) => ({
      payroll_id: id,
      ...m,
    }));

    const { data: members, error: membersErr } = await supabase
      .from("payroll_members")
      .insert(memberRows)
      .select("id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo");

    if (membersErr) {
      throw new DatabaseConnectionError(membersErr.message || "Failed to update payroll members");
    }

    const enriched = await this.enrichMembers(members || []);
    return this.toPayroll(payroll, enriched);
  }

  private async resolveMembers(members: MemberInput[], employerId: string, employerWallet: string) {
    const resolved: {
      worker_id: string | null;
      wallet_address: string;
      label: string | null;
      amount_usdc: number;
      memo: string | null;
    }[] = [];

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const idx = i + 1;

      if (m.amount_usdc <= 0) throw new PayrollInputError(`Member ${idx}: amount must be > 0`);

      if (m.username) {
        const uname = m.username.trim().toLowerCase().replace(/^@/, "");
        const { data: worker } = await supabase
          .from("users")
          .select("id, wallet_address")
          .eq("username", uname)
          .single();

        if (!worker) throw new PayrollInputError(`Member ${idx}: "@${uname}" not found`);
        if (worker.id === employerId) throw new PayrollInputError(`Member ${idx}: you cannot add yourself`);

        resolved.push({
          worker_id: worker.id,
          wallet_address: worker.wallet_address,
          label: null,
          amount_usdc: m.amount_usdc,
          memo: m.memo || null,
        });
      } else if (m.wallet_address) {
        const wallet = validateWallet(m.wallet_address, `Member ${idx} wallet`);
        if (wallet === employerWallet) throw new PayrollInputError(`Member ${idx}: you cannot add yourself`);

        const { data: worker } = await supabase
          .from("users")
          .select("id")
          .eq("wallet_address", wallet)
          .maybeSingle();

        resolved.push({
          worker_id: worker?.id ?? null,
          wallet_address: wallet,
          label: m.label?.trim() || null,
          amount_usdc: m.amount_usdc,
          memo: m.memo || null,
        });
      } else {
        throw new PayrollInputError(`Member ${idx}: username or wallet required`);
      }
    }
    return resolved;
  }

  /**
   * Set or update the recurring schedule for a payroll group.
   */
  async schedulePayroll(
    id: string,
    employerWallet: string,
    frequency: PayrollFrequency,
  ): Promise<void> {
    const wallet = validateWallet(employerWallet);

    const { data: employer } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", wallet)
      .single();

    if (!employer) throw new PayrollInputError("Employer wallet not found");

    // Calculate next run (for now just tomorrow)
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setHours(9, 0, 0, 0);

    const { error } = await supabase
      .from("payroll_schedules")
      .update({
        frequency,
        next_run_at: nextRun.toISOString(),
      })
      .eq("id", id)
      .eq("employer_id", employer.id);

    if (error)
      throw new DatabaseConnectionError(
        error.message || "Failed to schedule payroll",
      );
  }

  /**
   * Trigger an immediate execution of all members in the group.
   */
  async executePayroll(
    id: string,
    employerWallet: string,
  ): Promise<void> {
    const wallet = validateWallet(employerWallet);

    const { data: employer } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", wallet)
      .single();

    if (!employer) throw new PayrollInputError("Employer wallet not found");

    // Verify ownership
    const { data: payroll } = await supabase
      .from("payroll_schedules")
      .select("id")
      .eq("id", id)
      .eq("employer_id", employer.id)
      .single();

    if (!payroll) throw new PayrollInputError("Payroll group not found");

    // In a real system, this would queue a job or hit a smart contract.
    // For now we'll just log it as executed.
    console.log(`Executing payroll ${id} immediately for employer ${wallet}`);
  }

  /**
   * Deactivate an entire payroll group.
   */
  async deactivatePayroll(
    payrollId: string,
    employerWallet: string,
  ): Promise<void> {
    const wallet = validateWallet(employerWallet);

    const { data: employer } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", wallet)
      .single();

    if (!employer) throw new PayrollInputError("Employer wallet not found");

    const { error } = await supabase
      .from("payroll_schedules")
      .update({ is_active: false })
      .eq("id", payrollId)
      .eq("employer_id", employer.id);

    if (error)
      throw new DatabaseConnectionError(
        error.message || "Failed to deactivate payroll",
      );
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async enrichMembers(members: any[]): Promise<PayrollMember[]> {
    const workerIds = members
      .map((m) => m.worker_id)
      .filter((id): id is string => !!id);

    let userMap: Record<
      string,
      { username: string; display_name: string; icon_key: string | null }
    > = {};

    if (workerIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, username, display_name, icon_key")
        .in("id", workerIds);

      for (const u of users || []) {
        userMap[u.id] = {
          username: u.username,
          display_name: u.display_name,
          icon_key: u.icon_key,
        };
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
    return {
      id: row.id,
      employer_id: row.employer_id,
      worker_id: row.worker_id ?? null,
      title: row.title,
      notification_email: row.notification_email ?? null,
      is_active: row.is_active,
      memo: row.memo ?? null,
      member_count: members.length,
      total_usdc: Number(row.amount_usdc ?? members.reduce((sum, m) => sum + m.amount_usdc, 0)),
      members,
      frequency: row.frequency ?? null,
      next_run_at: row.next_run_at ?? null,
      created_at: row.created_at,
    };
  }
}
