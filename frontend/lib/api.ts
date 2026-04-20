import axios from "axios";

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  wallet_address: string;
  avatar_url: string | null;
  icon_key: string;
  bio: string | null;
  is_verified: boolean;
  total_payments: number;
  total_volume_usdc: number;
  default_link_id: string;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
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
  status: 'pending' | 'signed' | 'released' | 'cancelled';
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

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001",
});

export { api };

// ── User ──────────────────────────────────────────────────────────────────────

export async function fetchUserProfile(username: string) {
  try {
    const { data } = await api.get<{ success: boolean; user: UserProfile }>(
      `/users/${username}`,
    );
    return data.user;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

export async function fetchUserProfileByWallet(walletAddress: string) {
  try {
    const { data } = await api.get<{ success: boolean; user: UserProfile }>(
      `/users/by-wallet/${walletAddress}`,
    );
    return data.user;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

export async function onboardUser(payload: {
  username: string;
  walletAddress: string;
  icon_key?: string;
}) {
  const { data } = await api.post<{ success: boolean; user: UserProfile }>(
    "/onboard",
    payload,
  );
  return data.user;
}

export async function checkUsernameAvailability(username: string) {
  const { data } = await api.get<{ success: boolean; available: boolean }>(
    `/users/available/${username}`,
  );
  return data.available;
}

// ── Payroll ───────────────────────────────────────────────────────────────────

interface CreatePayrollMemberPayload {
  username?: string;
  wallet_address?: string;
  label?: string;
  amount_usdc: number;
  memo?: string;
}

export async function createPayroll(payload: {
  employer_wallet: string;
  title: string;
  notification_email?: string;
  members: CreatePayrollMemberPayload[];
}) {
  const { data } = await api.post<{ success: boolean; payroll: Payroll }>(
    "/payroll",
    payload,
  );
  return data.payroll;
}

export async function fetchPayrolls(employer_wallet: string) {
  const { data } = await api.get<{
    success: boolean;
    payroll_schedules: Payroll[];
  }>(`/payroll`, { params: { employer_wallet } });
  return data.payroll_schedules;
}

export async function deactivatePayroll(
  payrollId: string,
  employer_wallet: string,
) {
  const { data } = await api.patch<{ success: boolean }>(
    `/payroll/${payrollId}/deactivate`,
    { employer_wallet },
  );
  return data.success;
}

export async function updatePayroll(
  payrollId: string,
  payload: {
    employer_wallet: string;
    title: string;
    notification_email?: string;
    members: CreatePayrollMemberPayload[];
  },
) {
  const { data } = await api.put<{ success: boolean; payroll: Payroll }>(
    `/payroll/${payrollId}`,
    payload,
  );
  return data.payroll;
}

export async function schedulePayroll(
  payrollId: string,
  employer_wallet: string,
  frequency: PayrollFrequency,
  escrow_tx_sig?: string,
) {
  const { data } = await api.patch<{ success: boolean; cycle: PayrollCycle }>(
    `/payroll/${payrollId}/schedule`,
    { employer_wallet, frequency, escrow_tx_sig },
  );
  return data;
}

export async function executePayroll(
  payrollId: string,
  employer_wallet: string,
) {
  const { data } = await api.post<{ success: boolean }>(
    `/payroll/${payrollId}/execute`,
    { employer_wallet },
  );
  return data.success;
}

export async function cancelPayroll(
  payrollId: string,
  employer_wallet: string,
  refund_tx_sig?: string,
) {
  const { data } = await api.post<{ success: boolean }>(
    `/payroll/${payrollId}/cancel`,
    { employer_wallet, refund_tx_sig },
  );
  return data.success;
}

export async function signPayrollCycle(
  cycleId: string,
  employer_wallet: string,
  tx_signature: string,
) {
  const { data } = await api.post<{ success: boolean }>(
    `/payroll/cycles/${cycleId}/sign`,
    { employer_wallet, tx_signature },
  );
  return data.success;
}

export async function fetchClaimablePayments(wallet: string) {
  const { data } = await api.get<{ success: boolean; claims: any[] }>(
    `/payroll/claimable`,
    { params: { wallet } },
  );
  return data.claims;
}

export async function claimScheduledPayment(
  claimId: string,
  wallet_address: string,
  tx_signature: string,
) {
  const { data } = await api.post<{ success: boolean }>(
    `/payroll/claims/${claimId}/claim`,
    { wallet_address, tx_signature },
  );
  return data.success;
}

export async function initiateMultiPayment(payload: {
  sender_pubkey: string;
  recipients: { wallet_address: string; amount_usdc: number; label?: string; memo?: string }[];
}) {
  const { data } = await api.post<{
    success: boolean;
    mode: 'multi';
    transactions: string[];
    recipients: { wallet_address: string; label?: string; amount_usdc: number; memo?: string }[];
  }>('/payments/initiate', payload);
  return data;
}

export async function confirmBulkPayment(payload: {
  sender_wallet: string;
  memo?: string;
  recipients: { wallet_address: string; amount_usdc: number; signature: string; label?: string; memo?: string }[];
}) {
  const { data } = await api.post<{ success: boolean; payment_id: string; recipient_count: number }>(
    '/payments/confirm-bulk',
    payload,
  );
  return data;
}

export interface PaymentHistoryItem {
  id: string;
  amount_usdc: number;
  status: string;
  created_at: string;
  tx_signature: string;
  payment_type: string;
  recipient_count: number;
  sender_wallet: string;
  recipient: {
    username: string;
    display_name: string;
    wallet_address: string;
    icon_key: string;
  } | null;
}

export async function fetchPaymentHistory(wallet: string) {
  const { data } = await api.get<{ success: boolean; payments: PaymentHistoryItem[] }>('/payments/history', {
    params: { wallet }
  });
  return data.payments;
}

// ── Payment Links ─────────────────────────────────────────────────────────────

export interface PaymentLink {
  id: string;
  link_id: string;
  owner_id: string;
  link_type: string;
  title: string | null;
  description: string | null;
  amount_usdc: number | null;
  memo: string | null;
  icon_key: string;
  view_count: number;
  payment_count: number;
  total_received: number;
  is_active: boolean;
  is_archived: boolean;
  created_at: string;
}

export async function fetchPaymentLinks(
  wallet: string,
  includeArchived = false,
) {
  const { data } = await api.get<PaymentLink[]>("/paylinks", {
    params: { wallet, includeArchived },
  });
  return data;
}

export async function fetchPaymentLinkBySlug(slug: string) {
  const { data } = await api.get<PaymentLink & { owner: UserProfile }>(
    `/paylinks/${slug}`,
  );
  return data;
}

export async function createPaymentLink(payload: {
  owner_wallet: string;
  title: string;
  icon_key: string;
  amount_usdc?: number | null;
  memo?: string;
  link_type?: string;
}) {
  const { data } = await api.post<PaymentLink>("/paylinks", payload);
  return data;
}

export async function archivePaymentLink(id: string, wallet: string) {
  const { data } = await api.patch<{ success: boolean }>(
    `/paylinks/${id}/archive`,
    { wallet },
  );
  return data.success;
}

export async function trackLinkView(id: string) {
  await api.post(`/paylinks/${id}/view`);
}
