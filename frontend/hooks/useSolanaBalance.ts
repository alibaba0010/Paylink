import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQuery } from '@tanstack/react-query';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

const USDC_MINT = new PublicKey('4zMMC9srt5Ri5XzYSU7asCcBkMcsAnvMMSivtm96fM1V');

export function useSolanaBalance() {
  const { connection }   = useConnection();
  const { publicKey }    = useWallet();

  return useQuery({
    queryKey: ['usdc-balance', publicKey?.toString()],
    enabled:  !!publicKey,
    refetchInterval: 15_000,  // refresh every 15 seconds
    queryFn: async () => {
      const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey!);
      try {
        const account = await connection.getTokenAccountBalance(ata);
        return {
          usdc:    parseFloat(account.value.uiAmount?.toFixed(2) || '0'),
          raw:     account.value.amount,
        };
      } catch {
        return { usdc: 0, raw: '0' };  // Account doesn't exist yet
      }
    },
  });
}
