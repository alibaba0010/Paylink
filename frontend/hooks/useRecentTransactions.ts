import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQuery } from '@tanstack/react-query';

export function useRecentTransactions() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useQuery({
    queryKey: ['recent-transactions', publicKey?.toString()],
    enabled: !!publicKey,
    refetchInterval: 30_000,
    queryFn: async () => {
      const signatures = await connection.getSignaturesForAddress(publicKey!, { limit: 10 });
      
      // For now, we'll just return the signatures with some basic info
      // Fetching full transaction details for each signature can be slow/expensive
      // but we can at least show the signatures and their status.
      
      return signatures.map(sig => ({
        signature: sig.signature,
        slot: sig.slot,
        time: sig.blockTime ? new Date(sig.blockTime * 1000).toLocaleString() : 'Pending',
        status: sig.err ? 'Failed' : 'Success',
        memo: sig.memo || ''
      }));
    },
  });
}
