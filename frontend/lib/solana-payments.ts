import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const POLL_INTERVAL_MS = 1_500;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function usdcToRawAmount(amountUsdc: number) {
  return BigInt(Math.round(amountUsdc * 1_000_000));
}

export async function getUsdcBalanceRaw(connection: Connection, owner: PublicKey) {
  const ata = await getAssociatedTokenAddress(DEVNET_USDC_MINT, owner);

  try {
    const balance = await connection.getTokenAccountBalance(ata, 'confirmed');
    return BigInt(balance.value.amount);
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (
      message.includes('could not find account') ||
      message.includes('Invalid param: could not find account')
    ) {
      return BigInt(0);
    }

    throw error;
  }
}

export async function confirmSignatureWithStatus(
  connection: Connection,
  signature: string,
  timeoutMs = 75_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];

    if (status?.err) {
      throw new Error(`Transaction failed on Solana: ${JSON.stringify(status.err)}`);
    }

    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out while confirming the transaction. Signature: ${signature}. Check Solscan before retrying.`,
  );
}

export async function waitForRecipientUsdcCredit(
  connection: Connection,
  recipientWallet: string,
  amountUsdc: number,
  startingBalanceRaw: bigint,
  timeoutMs = 45_000,
) {
  const recipient = new PublicKey(recipientWallet);
  const expectedBalance = startingBalanceRaw + usdcToRawAmount(amountUsdc);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentBalance = await getUsdcBalanceRaw(connection, recipient);
    if (currentBalance >= expectedBalance) return;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    'The transaction confirmed, but the recipient USDC balance has not updated yet. Check the transaction on Solscan before retrying.',
  );
}
