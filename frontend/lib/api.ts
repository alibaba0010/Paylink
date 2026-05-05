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

export interface ScheduledPaymentClaim {
  id: string;
  cycle_id: string;
  payroll_id: string;
  wallet_address?: string;
  amount_usdc: number;
  status: 'pending' | 'claimable' | 'claimed' | 'cancelled';
  claimable_at: string;
  claimed_at: string | null;
  created_at: string;
  can_claim: boolean;
  is_locked: boolean;
  scheduled_payment_cycles: {
    due_at: string;
    cycle_number?: number;
    tx_signature: string | null;
    employer_signed: boolean;
  } | null;
  payroll_schedules: {
    title: string;
    employer_id: string;
    escrow_funded: boolean;
    escrow_tx_sig: string | null;
  } | null;
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") {
    // If user is on HTTPS, use the production API URL
    if (window.location.protocol === "https:") {
      return process.env.NEXT_PRODUCTION_API_URL || "https://paylink-zlow.onrender.com";
    }
  }
  // Default to the local/public API URL for HTTP (dev)
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
};

const api = axios.create({
  baseURL: getBaseUrl(),
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

export async function initiatePayrollFunding(
  payrollId: string,
  employer_wallet: string,
) {
  const { data } = await api.post<{
    success: boolean;
    transactions: string[];
    next_run_at: string;
  }>(`/payroll/${payrollId}/fund/initiate`, { employer_wallet });
  return data;
}

export async function confirmPayrollFunding(
  payrollId: string,
  employer_wallet: string,
  tx_signatures: string[],
) {
  const { data } = await api.post<{ success: boolean; payroll: Payroll }>(
    `/payroll/${payrollId}/fund/confirm`,
    { employer_wallet, tx_signatures },
  );
  return data.payroll;
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

export async function prepareCycleSign(
  cycleId: string,
  employer_wallet: string,
) {
  const { data } = await api.post<{
    success: boolean;
    transactions: string[];
    recipients: { wallet_address: string; amount_usdc: number; label?: string }[];
  }>(
    `/payroll/cycles/${cycleId}/prepare-sign`,
    { employer_wallet },
  );
  return data;
}

export async function fetchClaimablePayments(wallet: string) {
  const { data } = await api.get<{ success: boolean; claims: ScheduledPaymentClaim[] }>(
    `/payroll/claimable`,
    { params: { wallet } },
  );
  return data.claims;
}

export async function fetchOutgoingScheduledPayments(employer_wallet: string) {
  const { data } = await api.get<{ success: boolean; payments: ScheduledPaymentClaim[] }>(
    `/payroll/outgoing`,
    { params: { employer_wallet } },
  );
  return data.payments;
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

export async function rejectScheduledPayment(
  claimId: string,
  employer_wallet: string,
) {
  const { data } = await api.post<{ success: boolean }>(
    `/payroll/claims/${claimId}/reject`,
    { employer_wallet },
  );
  return data.success;
}

export async function claimPayment(
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

export async function requestGaslessClaim(
  claimId: string,
  wallet_address: string,
) {
  const { data } = await api.post<{ success: boolean; transaction: string }>(
    `/payroll/claims/${claimId}/claim-gasless`,
    { wallet_address },
  );
  return data.transaction;
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

export async function downloadPaymentHistoryCsv(wallet: string) {
  const { data } = await api.get<Blob>('/payments/history/export', {
    params: { wallet },
    responseType: 'blob',
  });
  return data;
}

export async function downloadPayrollCsv(employer_wallet: string) {
  const { data } = await api.get<Blob>('/payroll/export', {
    params: { employer_wallet },
    responseType: 'blob',
  });
  return data;
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

// ── Invoices ─────────────────────────────────────────────────────────────

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount_usdc: number;
  created_at: string;
}

export interface InvoiceComment {
  id: string;
  invoice_id: string;
  author_role: "creator" | "payer";
  author_name: string | null;
  author_wallet: string | null;
  body: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  creator_id: string;
  payer_email: string | null;
  payer_name: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "draft" | "sent" | "viewed" | "paid" | "cancelled";
  total_usdc: number;
  tx_signature: string | null;
  paid_at: string | null;
  paid_by_wallet: string | null;
  created_at: string;
  items: InvoiceItem[];
  comments: InvoiceComment[];
  creator?: UserProfile;
}

export async function createInvoice(payload: {
  creator_wallet: string;
  title: string;
  description?: string;
  payer_email?: string;
  payer_name?: string;
  due_date?: string;
  items: {
    description: string;
    quantity: number;
    unit_price: number;
  }[];
}) {
  const { data } = await api.post<{ success: boolean; invoice: Invoice }>("/invoices", payload);
  return data.invoice;
}

export async function fetchInvoices(creator_wallet: string) {
  const { data } = await api.get<{ success: boolean; invoices: Invoice[] }>("/invoices", {
    params: { creator_wallet },
  });
  return data.invoices;
}

export async function fetchInvoice(idOrNumber: string) {
  const { data } = await api.get<{ success: boolean; invoice: Invoice }>(`/invoices/${idOrNumber}`);
  return data.invoice;
}

export async function cancelInvoice(id: string, creator_wallet: string) {
  const { data } = await api.patch<{ success: boolean }>(`/invoices/${id}/status`, {
    creator_wallet,
    status: "cancelled",
  });
  return data.success;
}

export async function payInvoice(id: string, payer_wallet: string, tx_signature: string) {
  const { data } = await api.post<{ success: boolean }>(`/invoices/${id}/pay`, {
    payer_wallet,
    tx_signature,
  });
  return data.success;
}

export async function fetchInvoiceComments(id: string) {
  const { data } = await api.get<{ success: boolean; comments: InvoiceComment[] }>(`/invoices/${id}/comments`);
  return data.comments;
}

export async function addInvoiceComment(id: string, payload: {
  author_role: "creator" | "payer";
  author_name?: string;
  author_wallet?: string;
  body: string;
}) {
  const { data } = await api.post<{ success: boolean; comment: InvoiceComment }>(`/invoices/${id}/comments`, payload);
  return data.comment;
}

// ── Cross-Chain Payments ──────────────────────────────────────────────────

export async function getCrossChainLiquidity(payload: {
  amount_usdc: number;
}) {
  const { data } = await api.post<{
    success: boolean;
    available: boolean;
    message?: string;
    solanaTreasury?: {
      owner: string;
      usdcAta: string;
      usdcMint: string;
      balanceRaw: string;
      balanceUsdc: number;
      requiredAmountRaw: string;
      hasSufficientLiquidity: boolean;
      tokenAccountExists: boolean;
    };
    cctp?: {
      solanaDomain: number;
      mintRecipient: string;
      chains: Record<string, {
        domain: number;
        usdcAddress: string;
        tokenMessengerAddress: string;
      }>;
    };
  }>(`/cross-chain/preflight`, payload);
  return data;
}

export async function verifyCrossChainPayment(payload: {
  source_chain: string;
  tx_hash: string;
  recipient_wallet: string;
  amount_usdc: number;
}) {
  const { data } = await api.post<{
    success: boolean;
    status?: 'pending' | 'completed';
    message?: string;
    destTxSignature?: string;
  }>(`/cross-chain/verify`, payload);
  return data;
}

// ── Reputation Score ──────────────────────────────────────────────────────

export interface ReputationScore {
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  label: string;
  breakdown: {
    volume: number;
    consistency: number;
    longevity: number;
    activity: number;
    trust: number;
  };
  stats: {
    total_volume_usdc: number;
    total_payments: number;
    completed_payroll_cycles: number;
    cancelled_payrolls: number;
    account_age_days: number;
  };
  loan_eligibility_usdc: number;
  computed_at: string;
}

export async function fetchReputationScore(username: string) {
  try {
    const { data } = await api.get<{ success: boolean; username: string; reputation: ReputationScore }>(`/users/${username}/reputation`);
    return data.reputation;
  } catch (error) {
    console.error("Failed to fetch reputation score:", error);
    return null;
  }
}

export async function getOfframpRate() {
  const { data } = await api.get('/offramp/rate');
  return data.rate;
}

export async function initiateOffRamp(payload: {
  workerWallet: string;
  amountUSDC: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}) {
  const { data } = await api.post('/offramp/initiate', payload);
  return data.result;
}
