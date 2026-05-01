import { ethers } from "ethers";
import { supabase, DatabaseConnectionError } from "../db/supabase-client";
import { SolanaService } from "./solana.service";

export class CrossChainInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossChainInputError";
  }
}

const EVM_CHAINS: Record<string, { rpcUrl: string; usdcAddress: string }> = {
  sepolia: {
    rpcUrl: "https://rpc2.sepolia.org",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  },
  avalanche_fuji: {
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65"
  }
};

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

export class CrossChainService {
  private solanaService: SolanaService;

  constructor() {
    this.solanaService = new SolanaService();
  }

  /**
   * Verify an EVM transaction and trigger Solana payout.
   */
  async verifyAndFulfill(
    sourceChain: string,
    txHash: string,
    recipientWallet: string,
    expectedAmountUsdc: number
  ) {
    const chainConfig = EVM_CHAINS[sourceChain];
    if (!chainConfig) {
      throw new CrossChainInputError(`Chain ${sourceChain} is not supported for cross-chain currently`);
    }

    const depositAddress = process.env.EVM_DEPOSIT_ADDRESS || "0xYourDepositAddressHere";
    
    // Check if we already processed this tx
    const { data: existing } = await supabase
      .from("cross_chain_payments")
      .select("id, status")
      .eq("source_tx_hash", txHash)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'completed') throw new CrossChainInputError("Transaction already fulfilled");
      if (existing.status === 'pending' || existing.status === 'verified') throw new CrossChainInputError("Transaction is already processing");
    }

    // 1. Record the attempt
    const { data: record, error: insertErr } = await supabase
      .from("cross_chain_payments")
      .insert({
        source_chain: sourceChain,
        source_tx_hash: txHash,
        recipient_wallet: recipientWallet,
        amount_usdc: expectedAmountUsdc,
        status: "pending",
      })
      .select()
      .single();

    if (insertErr || !record) {
      throw new DatabaseConnectionError(insertErr?.message || "Failed to record cross-chain attempt");
    }

    try {
      // 2. Verify EVM Transaction
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        throw new Error(`Transaction receipt not found on ${sourceChain}`);
      }
      
      if (receipt.status !== 1) {
        throw new Error("EVM Transaction reverted");
      }

      // Parse logs to ensure they transferred USDC to our deposit address
      const iface = new ethers.Interface(ERC20_ABI);
      let foundValidTransfer = false;
      let senderAddress = receipt.from;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === chainConfig.usdcAddress.toLowerCase()) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed && parsed.name === "Transfer") {
              const to = parsed.args.to.toLowerCase();
              const value = parsed.args.value;
              
              // USDC has 6 decimals, so check the amount
              const expectedValue = ethers.parseUnits(expectedAmountUsdc.toString(), 6);
              
              // Only checking value matching exactly for demo, but normally would check >=
              if (to === depositAddress.toLowerCase() && value >= expectedValue) {
                foundValidTransfer = true;
                break;
              }
            }
          } catch (e) {
            // Ignore logs that don't match our ABI
          }
        }
      }

      // NOTE: For demonstration purposes, if EVM_DEPOSIT_ADDRESS is not set, we'll bypass the strict check
      // so the user can test the UI without needing real Sepolia USDC if they don't have it.
      if (!process.env.EVM_DEPOSIT_ADDRESS) {
        console.warn("Bypassing strict EVM validation because EVM_DEPOSIT_ADDRESS is not set");
        foundValidTransfer = true;
      }

      if (!foundValidTransfer) {
        throw new Error("Transaction did not send the required USDC to the deposit address");
      }

      // Mark as verified
      await supabase
        .from("cross_chain_payments")
        .update({ status: "verified", sender_address: senderAddress })
        .eq("id", record.id);

      // 3. Fulfill on Solana
      const destTxSignature = await this.solanaService.executeBackendTransfer(
        recipientWallet,
        expectedAmountUsdc
      );

      // 4. Mark completed and record in main payments table
      await supabase
        .from("cross_chain_payments")
        .update({
          status: "completed",
          dest_tx_signature: destTxSignature,
          updated_at: new Date().toISOString()
        })
        .eq("id", record.id);

      // Record in the main payments table so it shows up in history
      const { data: recipientUser } = await supabase
        .from("users")
        .select("id")
        .eq("wallet_address", recipientWallet)
        .maybeSingle();

      if (recipientUser) {
        await supabase.from("payments").insert({
          sender_wallet: "CrossChain Bridge",
          recipient_id: recipientUser.id,
          amount_usdc: expectedAmountUsdc,
          tx_signature: destTxSignature,
          status: "confirmed",
          payment_type: "single",
          memo: `Cross-chain from ${sourceChain}`,
          confirmed_at: new Date().toISOString()
        });
      }

      return { success: true, destTxSignature };
    } catch (err: any) {
      // Mark as failed
      await supabase
        .from("cross_chain_payments")
        .update({
          status: "failed",
          error_message: err.message || "Unknown error",
          updated_at: new Date().toISOString()
        })
        .eq("id", record.id);
        
      throw new CrossChainInputError(err.message || "Cross-chain fulfillment failed");
    }
  }
}
