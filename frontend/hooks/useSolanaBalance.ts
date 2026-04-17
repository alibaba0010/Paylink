import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export function useSolanaBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useQuery({
    queryKey: ["solana-balances", publicKey?.toString()],
    enabled: !!publicKey,
    refetchInterval: 15_000, // refresh every 15 seconds
    queryFn: async () => {
      try {
        // 1. Get SOL Balance
        const solLamports = await connection.getBalance(publicKey!);
        const solBalance = solLamports / 1_000_000_000;

        // 2. Get USDC Balance
        const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey!);
        let usdcBalance = 0;
        try {
          const account = await connection.getTokenAccountBalance(ata);
          usdcBalance = parseFloat(account.value.uiAmount?.toFixed(2) || "0");
        } catch (e) {
          // Account doesn't exist yet or has no balance
          console.log("USDC account not found or empty:", e);
        }

        return {
          usdc: usdcBalance,
          sol: parseFloat(solBalance.toFixed(4)),
        };
      } catch (error) {
        console.error("Error fetching solana balances:", error);
        return { usdc: 0, sol: 0 };
      }
    },
  });
}
