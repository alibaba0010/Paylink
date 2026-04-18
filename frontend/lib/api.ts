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
) {
  const { data } = await api.patch<{ success: boolean }>(
    `/payroll/${payrollId}/schedule`,
    { employer_wallet, frequency },
  );
  return data.success;
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
