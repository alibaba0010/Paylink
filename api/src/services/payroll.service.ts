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

export interface PayrollCycle {
  id: string;
  payroll_id: string;
  cycle_number: number;
  due_at: string;
  sign_open_at: string;
  employer_signed: boolean;
  signed_at: string | null;
  tx_signature: string | null;
  status: string;
  notified_at: string | null;
  created_at: string;
}

export interface Payroll {
  id: string;
  employer_id: string;
  worker_id: string | null;
  title: string;
  notification_email: string | null;
  is_active: boolean;
  memo: string | null;
  member_count: number;
  total_usdc: number;
  members: PayrollMember[];
  frequency: PayrollFrequency | null;
  next_run_at: string | null;
  escrow_funded: boolean;
  escrow_amount_usdc: number;
  escrow_tx_sig: string | null;
  cancelled_at: string | null;
  cycles: PayrollCycle[];
  created_at: string;
}

interface MemberInput {
  username?: string;
  wallet_address?: string;
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

/** Compute the next N cycle due dates from a start point */
function computeCycleDates(
  frequency: PayrollFrequency,
  from: Date,
  count = 1,
): Date[] {
  const dates: Date[] = [];
  let cursor = new Date(from);
  for (let i = 0; i < count; i++) {
    if (frequency === "weekly") cursor.setDate(cursor.getDate() + 7);
    else if (frequency === "biweekly") cursor.setDate(cursor.getDate() + 14);
    else cursor.setMonth(cursor.getMonth() + 1);
    dates.push(new Date(cursor));
  }
  return dates;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class PayrollService {

  /** Create a payroll group. Escrow funding happens in a separate step. */
  async createPayroll(input: CreatePayrollInput): Promise<Payroll> {
    const employerWallet = validateWallet(input.employer_wallet, "Employer wallet");

    if (!input.title || input.title.trim().length < 2)
      throw new PayrollInputError("Payroll title must be at least 2 characters");
    if (!input.members || input.members.length === 0)
      throw new PayrollInputError("At least one member is required");
    if (input.notification_email) validateEmail(input.notification_email);

    const { data: employer, error: employerErr } = await supabase
      .from("users").select("id").eq("wallet_address", employerWallet).single();
    if (employerErr || !employer)
      throw new PayrollInputError("Employer wallet is not registered on PayLink");

    const resolvedMembers = await this.resolveMembers(input.members, employer.id, employerWallet);
    const totalUsdc = resolvedMembers.reduce((sum, m) => sum + m.amount_usdc, 0);

    const { data: payroll, error: payrollErr } = await supabase
      .from("payroll_schedules")
      .insert({
        employer_id: employer.id,
        title: input.title.trim(),
        notification_email: input.notification_email || null,
        is_active: true,
        amount_usdc: totalUsdc,
        escrow_funded: false,
        escrow_amount_usdc: 0,
      })
      .select("id, employer_id, worker_id, title, notification_email, is_active, amount_usdc, memo, escrow_funded, escrow_amount_usdc, escrow_tx_sig, cancelled_at, frequency, next_run_at, created_at")
      .single();

    if (payrollErr || !payroll)
      throw new DatabaseConnectionError(payrollErr?.message || "Failed to create payroll");

    const memberRows = resolvedMembers.map((m) => ({ payroll_id: payroll.id, ...m }));
    const { data: members, error: membersErr } = await supabase
      .from("payroll_members")
      .insert(memberRows)
      .select("id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo");

    if (membersErr) {
      await supabase.from("payroll_schedules").delete().eq("id", payroll.id);
      throw new DatabaseConnectionError(membersErr.message || "Failed to add payroll members");
    }

    const enriched = await this.enrichMembers(members || []);
    return this.toPayroll(payroll, enriched, []);
  }

  /** List all active payrolls for an employer with members and cycles. */
  async listPayrolls(employerWallet: string): Promise<Payroll[]> {
    const wallet = validateWallet(employerWallet);
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!employer) return [];

    // Try the full query (requires migration 005). If the new columns or
    // the scheduled_payment_cycles table don't exist yet, fall back to the
    // baseline columns so the endpoint never returns 503.
    let data: any[] | null = null;
    let usedFallback = false;

    const fullResult = await supabase
      .from("payroll_schedules")
      .select(`
        id, employer_id, worker_id, title, notification_email, is_active,
        amount_usdc, memo, escrow_funded, escrow_amount_usdc, escrow_tx_sig,
        cancelled_at, frequency, next_run_at, created_at,
        payroll_members(id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo),
        scheduled_payment_cycles(id, payroll_id, cycle_number, due_at, sign_open_at, employer_signed, signed_at, tx_signature, status, notified_at, created_at)
      `)
      .eq("employer_id", employer.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (!fullResult.error) {
      data = fullResult.data;
    } else {
      // Migration 005 not yet applied — fall back to baseline columns only
      console.warn("[listPayrolls] Full query failed, using fallback:", fullResult.error.message);
      usedFallback = true;
      const fallbackResult = await supabase
        .from("payroll_schedules")
        .select(`
          id, employer_id, worker_id, title, notification_email, is_active,
          amount_usdc, memo, created_at,
          payroll_members(id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo)
        `)
        .eq("employer_id", employer.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (fallbackResult.error) {
        throw new DatabaseConnectionError(fallbackResult.error.message || "Failed to fetch payrolls");
      }
      data = fallbackResult.data;
    }

    const results: Payroll[] = [];
    for (const row of data || []) {
      const enriched = await this.enrichMembers(row.payroll_members || []);
      const cycles = usedFallback ? [] : (row.scheduled_payment_cycles || []);
      results.push(this.toPayroll(row, enriched, cycles));
    }
    return results;
  }

  /** Update payroll group metadata + member list. */
  async updatePayroll(id: string, input: CreatePayrollInput): Promise<Payroll> {
    const employerWallet = validateWallet(input.employer_wallet, "Employer wallet");
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", employerWallet).single();
    if (!employer) throw new PayrollInputError("Employer wallet not found");

    const { data: existing } = await supabase
      .from("payroll_schedules").select("id").eq("id", id).eq("employer_id", employer.id).single();
    if (!existing) throw new PayrollInputError("Payroll group not found or access denied");

    if (input.notification_email) validateEmail(input.notification_email);
    const resolvedMembers = await this.resolveMembers(input.members, employer.id, employerWallet);
    const totalUsdc = resolvedMembers.reduce((sum, m) => sum + m.amount_usdc, 0);

    const { data: payroll, error: payrollErr } = await supabase
      .from("payroll_schedules")
      .update({ title: input.title.trim(), notification_email: input.notification_email || null, amount_usdc: totalUsdc })
      .eq("id", id)
      .select("id, employer_id, worker_id, title, notification_email, is_active, amount_usdc, memo, escrow_funded, escrow_amount_usdc, escrow_tx_sig, cancelled_at, frequency, next_run_at, created_at")
      .single();

    if (payrollErr || !payroll)
      throw new DatabaseConnectionError(payrollErr?.message || "Failed to update payroll");

    await supabase.from("payroll_members").delete().eq("payroll_id", id);
    const memberRows = resolvedMembers.map((m) => ({ payroll_id: id, ...m }));
    const { data: members, error: membersErr } = await supabase
      .from("payroll_members").insert(memberRows)
      .select("id, payroll_id, worker_id, wallet_address, label, amount_usdc, memo");

    if (membersErr) throw new DatabaseConnectionError(membersErr.message || "Failed to update members");

    const enriched = await this.enrichMembers(members || []);
    return this.toPayroll(payroll, enriched, []);
  }

  /**
   * Activate schedule: set frequency + next_run_at, generate first cycle,
   * and mark escrow as funded (tx sig supplied by frontend after on-chain deposit).
   *
   * During creation the TOTAL amount is locked into escrow on-chain.
   * Each cycle unlocks the per-member amounts when due_at is reached.
   */
  async schedulePayroll(
    id: string,
    employerWallet: string,
    frequency: PayrollFrequency,
    escrowTxSig?: string,
  ): Promise<PayrollCycle> {
    const wallet = validateWallet(employerWallet);
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!employer) throw new PayrollInputError("Employer wallet not found");

    const { data: payroll, error: fetchErr } = await supabase
      .from("payroll_schedules")
      .select("id, employer_id, amount_usdc, is_active, escrow_funded, title, notification_email")
      .eq("id", id).eq("employer_id", employer.id).single();

    if (fetchErr || !payroll) throw new PayrollInputError("Payroll group not found");
    if (!payroll.is_active) throw new PayrollInputError("Payroll group is deactivated");

    // First due date = one period from now
    const now = new Date();
    const [dueDate] = computeCycleDates(frequency, now, 1);
    const signOpenAt = new Date(dueDate.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days before

    // Update the schedule
    const { error: updateErr } = await supabase
      .from("payroll_schedules")
      .update({
        frequency,
        next_run_at: dueDate.toISOString(),
        escrow_funded: escrowTxSig ? true : payroll.escrow_funded,
        escrow_tx_sig: escrowTxSig || null,
        escrow_amount_usdc: Number(payroll.amount_usdc),
      })
      .eq("id", id).eq("employer_id", employer.id);

    if (updateErr) throw new DatabaseConnectionError(updateErr.message || "Failed to schedule payroll");

    // Create the first cycle
    const { data: cycle, error: cycleErr } = await supabase
      .from("scheduled_payment_cycles")
      .insert({
        payroll_id: id,
        cycle_number: 1,
        due_at: dueDate.toISOString(),
        sign_open_at: signOpenAt.toISOString(),
        status: "pending",
        employer_signed: false,
      })
      .select("id, payroll_id, cycle_number, due_at, sign_open_at, employer_signed, signed_at, tx_signature, status, notified_at, created_at")
      .single();

    if (cycleErr || !cycle)
      throw new DatabaseConnectionError(cycleErr?.message || "Failed to create payment cycle");

    // Populate initial claims for each member
    const { data: members } = await supabase
      .from("payroll_members")
      .select("id, worker_id, wallet_address, amount_usdc")
      .eq("payroll_id", id).eq("is_active", true);

    if (members && members.length > 0) {
      const claimRows = members.map((m) => ({
        cycle_id: cycle.id,
        payroll_id: id,
        member_id: m.id,
        worker_id: m.worker_id ?? null,
        wallet_address: m.wallet_address,
        amount_usdc: m.amount_usdc,
        status: "pending",
        claimable_at: dueDate.toISOString(),
      }));
      await supabase.from("scheduled_payment_claims").insert(claimRows);
    }

    return cycle as PayrollCycle;
  }

  /**
   * Employer signs off on a cycle (must be within the 3-day signing window).
   * Accepts the on-chain tx signature that releases funds.
   */
  async signCycle(
    cycleId: string,
    employerWallet: string,
    txSignature: string,
  ): Promise<void> {
    const wallet = validateWallet(employerWallet);
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!employer) throw new PayrollInputError("Employer wallet not found");

    // Fetch cycle + payroll in one step
    const { data: cycle } = await supabase
      .from("scheduled_payment_cycles")
      .select("id, payroll_id, cycle_number, due_at, sign_open_at, status, payroll_schedules(employer_id, frequency, amount_usdc)")
      .eq("id", cycleId)
      .single() as any;

    if (!cycle) throw new PayrollInputError("Cycle not found");
    if (cycle.payroll_schedules?.employer_id !== employer.id)
      throw new PayrollInputError("Access denied");
    if (cycle.status !== "pending")
      throw new PayrollInputError(`Cycle is already ${cycle.status}`);

    const now = new Date();
    const signOpenAt = new Date(cycle.sign_open_at);
    if (now < signOpenAt)
      throw new PayrollInputError(`Signing window opens on ${signOpenAt.toISOString()}`);

    // Mark cycle as signed
    const { error } = await supabase
      .from("scheduled_payment_cycles")
      .update({ employer_signed: true, signed_at: now.toISOString(), tx_signature: txSignature, status: "signed" })
      .eq("id", cycleId);
    if (error) throw new DatabaseConnectionError(error.message);

    // Mark claims as claimable
    await supabase
      .from("scheduled_payment_claims")
      .update({ status: "claimable" })
      .eq("cycle_id", cycleId);

    // Create the NEXT cycle automatically
    const ps = cycle.payroll_schedules;
    if (ps?.frequency) {
      const dueAt = new Date(cycle.due_at);
      const [nextDue] = computeCycleDates(ps.frequency as PayrollFrequency, dueAt, 1);
      const nextSignOpen = new Date(nextDue.getTime() - 3 * 24 * 60 * 60 * 1000);

      const { data: nextCycle } = await supabase
        .from("scheduled_payment_cycles")
        .insert({
          payroll_id: cycle.payroll_id,
          cycle_number: cycle.cycle_number + 1,
          due_at: nextDue.toISOString(),
          sign_open_at: nextSignOpen.toISOString(),
          status: "pending",
          employer_signed: false,
        })
        .select("id").single();

      if (nextCycle) {
        const { data: members } = await supabase
          .from("payroll_members")
          .select("id, worker_id, wallet_address, amount_usdc")
          .eq("payroll_id", cycle.payroll_id).eq("is_active", true);

        if (members && members.length > 0) {
          await supabase.from("scheduled_payment_claims").insert(
            members.map((m) => ({
              cycle_id: nextCycle.id,
              payroll_id: cycle.payroll_id,
              member_id: m.id,
              worker_id: m.worker_id ?? null,
              wallet_address: m.wallet_address,
              amount_usdc: m.amount_usdc,
              status: "pending",
              claimable_at: nextDue.toISOString(),
            })),
          );
        }
        // Update next_run_at on the schedule
        await supabase.from("payroll_schedules")
          .update({ next_run_at: nextDue.toISOString() })
          .eq("id", cycle.payroll_id);
      }
    }
  }

  /**
   * Employer cancels the payroll — mark as inactive, flag for refund.
   * Funds should be returned to employer wallet via on-chain tx (initiated client-side).
   */
  async cancelPayroll(payrollId: string, employerWallet: string, refundTxSig?: string): Promise<void> {
    const wallet = validateWallet(employerWallet);
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!employer) throw new PayrollInputError("Employer wallet not found");

    const { error } = await supabase
      .from("payroll_schedules")
      .update({
        is_active: false,
        cancelled_at: new Date().toISOString(),
        refund_tx_sig: refundTxSig || null,
        escrow_funded: false,
      })
      .eq("id", payrollId).eq("employer_id", employer.id);

    if (error) throw new DatabaseConnectionError(error.message || "Failed to cancel payroll");

    // Cancel all pending cycles and claims
    const { data: pendingCycles } = await supabase
      .from("scheduled_payment_cycles")
      .select("id").eq("payroll_id", payrollId).eq("status", "pending");

    if (pendingCycles && pendingCycles.length > 0) {
      const cycleIds = pendingCycles.map((c) => c.id);
      await supabase.from("scheduled_payment_cycles").update({ status: "cancelled" }).in("id", cycleIds);
      await supabase.from("scheduled_payment_claims").update({ status: "cancelled" }).in("cycle_id", cycleIds);
    }
  }

  /** Trigger immediate execution (one-time group payment, no scheduling). */
  async executePayroll(id: string, employerWallet: string): Promise<void> {
    const wallet = validateWallet(employerWallet);
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!employer) throw new PayrollInputError("Employer wallet not found");

    const { data: payroll } = await supabase
      .from("payroll_schedules").select("id").eq("id", id).eq("employer_id", employer.id).single();
    if (!payroll) throw new PayrollInputError("Payroll group not found");

    console.log(`Executing payroll ${id} immediately for employer ${wallet}`);
  }

  /** Deactivate an entire payroll group. */
  async deactivatePayroll(payrollId: string, employerWallet: string): Promise<void> {
    const wallet = validateWallet(employerWallet);
    const { data: employer } = await supabase
      .from("users").select("id").eq("wallet_address", wallet).single();
    if (!employer) throw new PayrollInputError("Employer wallet not found");

    const { error } = await supabase
      .from("payroll_schedules").update({ is_active: false })
      .eq("id", payrollId).eq("employer_id", employer.id);
    if (error) throw new DatabaseConnectionError(error.message || "Failed to deactivate payroll");
  }

  /**
   * Get claimable payments for a recipient (worker).
   * Returns claims where status = 'claimable' and due_at <= now.
   */
  async getClaimablePayments(workerWallet: string): Promise<any[]> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("scheduled_payment_claims")
      .select(`
        id, cycle_id, payroll_id, amount_usdc, status, claimable_at, claimed_at,
        scheduled_payment_cycles(due_at, tx_signature, employer_signed),
        payroll_schedules(title, employer_id)
      `)
      .eq("wallet_address", workerWallet)
      .eq("status", "claimable")
      .lte("claimable_at", now)
      .order("claimable_at", { ascending: true });

    if (error) throw new DatabaseConnectionError(error.message);
    return data || [];
  }

  /**
   * Mark a claim as claimed after the on-chain release tx is confirmed.
   */
  async claimPayment(claimId: string, workerWallet: string, txSig: string): Promise<void> {
    const now = new Date();
    const { data: claim } = await supabase
      .from("scheduled_payment_claims")
      .select("id, claimable_at, status, wallet_address")
      .eq("id", claimId).single();

    if (!claim) throw new PayrollInputError("Claim not found");
    if (claim.wallet_address !== workerWallet)
      throw new PayrollInputError("Access denied");
    if (claim.status !== "claimable") throw new PayrollInputError(`Claim is ${claim.status}`);
    if (new Date(claim.claimable_at) > now)
      throw new PayrollInputError("Funds not yet available");

    const { error } = await supabase
      .from("scheduled_payment_claims")
      .update({ status: "claimed", claim_tx_sig: txSig, claimed_at: now.toISOString() })
      .eq("id", claimId);
    if (error) throw new DatabaseConnectionError(error.message);
  }

  /**
   * Check for cycles whose sign_open_at <= now and haven't been notified yet.
   * Called by a cron job (or manually) to send 3-day pre-payout notifications.
   */
  async sendPendingNotifications(): Promise<number> {
    const now = new Date().toISOString();
    const { data: cycles, error } = await supabase
      .from("scheduled_payment_cycles")
      .select(`
        id, payroll_id, due_at, sign_open_at, cycle_number,
        payroll_schedules(title, notification_email, employer_id,
          users!payroll_schedules_employer_id_fkey(email, display_name))
      `)
      .eq("status", "pending")
      .eq("employer_signed", false)
      .is("notified_at", null)
      .lte("sign_open_at", now);

    if (error) throw new DatabaseConnectionError(error.message);

    let count = 0;
    for (const cycle of cycles || []) {
      const ps = (cycle as any).payroll_schedules;
      const employer = ps?.users;

      console.log(`[Notification] Payroll "${ps?.title}" cycle ${cycle.cycle_number} — due ${cycle.due_at}`);
      console.log(`  Employer: ${employer?.display_name} | email: ${employer?.email || ps?.notification_email || 'none'}`);

      // Mark notified regardless of email result
      await supabase
        .from("scheduled_payment_cycles")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", cycle.id);

      count++;
    }
    return count;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async resolveMembers(members: MemberInput[], employerId: string, employerWallet: string) {
    const resolved: { worker_id: string | null; wallet_address: string; label: string | null; amount_usdc: number; memo: string | null }[] = [];

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const idx = i + 1;
      if (m.amount_usdc <= 0) throw new PayrollInputError(`Member ${idx}: amount must be > 0`);

      if (m.username) {
        const uname = m.username.trim().toLowerCase().replace(/^@/, "");
        const { data: worker } = await supabase
          .from("users").select("id, wallet_address").eq("username", uname).single();
        if (!worker) throw new PayrollInputError(`Member ${idx}: "@${uname}" not found`);
        if (worker.id === employerId) throw new PayrollInputError(`Member ${idx}: you cannot add yourself`);
        resolved.push({ worker_id: worker.id, wallet_address: worker.wallet_address, label: null, amount_usdc: m.amount_usdc, memo: m.memo || null });
      } else if (m.wallet_address) {
        const wallet = validateWallet(m.wallet_address, `Member ${idx} wallet`);
        if (wallet === employerWallet) throw new PayrollInputError(`Member ${idx}: you cannot add yourself`);
        const { data: worker } = await supabase.from("users").select("id").eq("wallet_address", wallet).maybeSingle();
        resolved.push({ worker_id: worker?.id ?? null, wallet_address: wallet, label: m.label?.trim() || null, amount_usdc: m.amount_usdc, memo: m.memo || null });
      } else {
        throw new PayrollInputError(`Member ${idx}: username or wallet required`);
      }
    }
    return resolved;
  }

  private async enrichMembers(members: any[]): Promise<PayrollMember[]> {
    const workerIds = members.map((m) => m.worker_id).filter((id): id is string => !!id);
    let userMap: Record<string, { username: string; display_name: string; icon_key: string | null }> = {};

    if (workerIds.length > 0) {
      const { data: users } = await supabase
        .from("users").select("id, username, display_name, icon_key").in("id", workerIds);
      for (const u of users || []) userMap[u.id] = { username: u.username, display_name: u.display_name, icon_key: u.icon_key };
    }

    return members.map((m) => {
      const user = m.worker_id ? userMap[m.worker_id] : null;
      return {
        id: m.id, payroll_id: m.payroll_id, worker_id: m.worker_id ?? null,
        wallet_address: m.wallet_address, label: m.label ?? null,
        username: user?.username ?? null, display_name: user?.display_name ?? null,
        icon_key: user?.icon_key ?? null, amount_usdc: Number(m.amount_usdc), memo: m.memo ?? null,
      };
    });
  }

  private toPayroll(row: any, members: PayrollMember[], cycles: any[]): Payroll {
    return {
      id: row.id, employer_id: row.employer_id, worker_id: row.worker_id ?? null,
      title: row.title, notification_email: row.notification_email ?? null,
      is_active: row.is_active, memo: row.memo ?? null,
      member_count: members.length,
      total_usdc: Number(row.amount_usdc ?? members.reduce((s, m) => s + m.amount_usdc, 0)),
      members, frequency: row.frequency ?? null, next_run_at: row.next_run_at ?? null,
      escrow_funded: row.escrow_funded ?? false,
      escrow_amount_usdc: Number(row.escrow_amount_usdc ?? 0),
      escrow_tx_sig: row.escrow_tx_sig ?? null,
      cancelled_at: row.cancelled_at ?? null,
      cycles: cycles.map((c) => ({
        id: c.id, payroll_id: c.payroll_id, cycle_number: c.cycle_number,
        due_at: c.due_at, sign_open_at: c.sign_open_at,
        employer_signed: c.employer_signed, signed_at: c.signed_at ?? null,
        tx_signature: c.tx_signature ?? null, status: c.status,
        notified_at: c.notified_at ?? null, created_at: c.created_at,
      })),
      created_at: row.created_at,
    };
  }
}
