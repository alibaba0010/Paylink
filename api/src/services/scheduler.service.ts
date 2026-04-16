import { Queue, Worker } from 'bullmq';
import { SolanaService } from './solana.service';
// Mock db import
const db = { payrollSchedules: { findById: async (id: string) => ({ is_active: true, employer_wallet: '', worker_wallet: '', amount_usdc: 0, frequency: 'monthly' }), update: async (id: string, data: any) => {} } };

const payrollQueue = new Queue('payroll', {
  connection: { host: process.env.REDIS_HOST, port: 6379 },
});

// Enqueue a payroll job at the right time
export async function schedulePayroll(scheduleId: string, runAt: Date) {
  const delay = runAt.getTime() - Date.now();
  await payrollQueue.add('run-payroll', { scheduleId }, { delay });
}

// Worker picks up and executes
new Worker('payroll', async (job) => {
  const { scheduleId } = job.data;
  const schedule = await db.payrollSchedules.findById(scheduleId);
  if (!schedule || !schedule.is_active) return;

  const solana = new SolanaService();

  // Build + auto-sign with employer's server-side keypair (for pre-authorized recurring)
  // In production: employer pre-authorizes a spending keypair for recurring
  const txBase64 = await solana.buildDepositTransaction(
    schedule.employer_wallet,
    schedule.worker_wallet,
    schedule.amount_usdc,
    0,
  );

  // ... sign and submit
  // Update next_run_at based on frequency
  const nextRun = computeNextRun(schedule.frequency, new Date());
  await db.payrollSchedules.update(scheduleId, { next_run_at: nextRun });
  await schedulePayroll(scheduleId, nextRun);
}, { connection: { host: process.env.REDIS_HOST, port: 6379 } });

function computeNextRun(frequency: string, from: Date): Date {
  const d = new Date(from);
  if (frequency === 'weekly')    d.setDate(d.getDate() + 7);
  if (frequency === 'biweekly')  d.setDate(d.getDate() + 14);
  if (frequency === 'monthly')   d.setMonth(d.getMonth() + 1);
  return d;
}
