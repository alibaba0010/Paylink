import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";
import { supabase, DatabaseConnectionError } from "../db/supabase-client";
import { SolanaService } from "./solana.service";

export class CrossChainInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossChainInputError";
  }
}

export class CrossChainLiquidityError extends Error {
  constructor(message = "Service unavailable at the moment, come back later.") {
    super(message);
    this.name = "CrossChainLiquidityError";
  }
}

const TOKEN_MESSENGER_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
];

const EVM_CHAINS: Record<string, {
  chainId: number;
  domain: number;
  rpcUrls: string[];
  usdcAddress: string;
  tokenMessengerAddress: string;
}> = {
  sepolia: {
    chainId: 11155111,
    domain: 0,
    rpcUrls: (process.env.SEPOLIA_RPC_URLS || process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com,https://rpc2.sepolia.org").split(",").map(url => url.trim()).filter(Boolean),
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessengerAddress: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  avalanche_fuji: {
    chainId: 43113,
    domain: 1,
    rpcUrls: (process.env.AVALANCHE_FUJI_RPC_URLS || process.env.AVALANCHE_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc").split(",").map(url => url.trim()).filter(Boolean),
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
    tokenMessengerAddress: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
};

const SOLANA_DOMAIN = 5;
const DESTINATION_CALLER_ANY = ethers.ZeroHash;

function pendingResponse(message: string) {
  return { success: true, status: "pending", message };
}

function isRetryableNetworkError(error: any) {
  const values = [
    error?.code,
    error?.error?.code,
    error?.shortMessage,
    error?.message,
  ].filter(Boolean).map(String);

  return values.some(value =>
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|timeout|failed to detect network|fetch failed/i.test(value)
  );
}

async function fetchEvmTransactionData(
  chainConfig: typeof EVM_CHAINS[string],
  sourceChain: string,
  txHash: string
) {
  let lastError: any;

  for (const rpcUrl of chainConfig.rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, chainConfig.chainId);
      console.log("[cross-chain] fetching EVM treasury deposit receipt", {
        sourceChain,
        txHash,
        rpcUrl,
      });

      const receipt = await provider.getTransactionReceipt(txHash);
      const transaction = receipt ? await provider.getTransaction(txHash) : null;
      return { receipt, transaction, rpcUrl };
    } catch (error: any) {
      lastError = error;
      console.warn("[cross-chain] EVM RPC lookup failed", {
        sourceChain,
        txHash,
        rpcUrl,
        message: error?.message || "Unknown RPC error",
      });
    }
  }

  throw lastError || new Error(`Unable to fetch transaction from ${sourceChain}`);
}

async function recordMirroredPayment(
  senderWallet: string,
  recipientWallet: string,
  amountUsdc: number,
  solanaSignature: string,
) {
  const { data: recipientUser } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", recipientWallet)
    .maybeSingle();

  const { error } = await supabase
    .from("payments")
    .insert({
      sender_wallet: senderWallet,
      recipient_id: recipientUser?.id ?? null,
      amount_usdc: amountUsdc,
      tx_signature: solanaSignature,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      payment_type: "cross_chain",
    });

  if (error && !error.code?.includes("23505")) {
    console.error("[cross-chain] payments history insert failed", {
      solanaSignature,
      recipientWallet,
      message: error.message,
    });
  }
}

export class CrossChainService {
  private solanaService = new SolanaService();

  async getLiquidityStatus(amountUsdc: number) {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw new CrossChainInputError("amount_usdc must be greater than zero");
    }

    const treasury = await this.solanaService.getBackendTreasuryStatus(amountUsdc);
    return {
      success: true,
      available: treasury.hasSufficientLiquidity,
      message: treasury.hasSufficientLiquidity
        ? undefined
        : "Service unavailable at the moment, come back later.",
      solanaTreasury: treasury,
      cctp: {
        solanaDomain: SOLANA_DOMAIN,
        mintRecipient: this.solanaAddressToBytes32(treasury.usdcAta),
        chains: Object.fromEntries(
          Object.entries(EVM_CHAINS).map(([id, chain]) => [
            id,
            {
              domain: chain.domain,
              usdcAddress: chain.usdcAddress,
              tokenMessengerAddress: chain.tokenMessengerAddress,
            },
          ]),
        ),
      },
    };
  }

  /**
   * Verify an inbound CCTP burn, then mirror it by paying Solana USDC from
   * the backend treasury wallet.
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
    if (!Number.isFinite(expectedAmountUsdc) || expectedAmountUsdc <= 0) {
      throw new CrossChainInputError("amount_usdc must be greater than zero");
    }

    const liquidity = await this.solanaService.getBackendTreasuryStatus(expectedAmountUsdc);
    if (!liquidity.hasSufficientLiquidity) {
      throw new CrossChainLiquidityError();
    }
    const expectedMintRecipient = this.solanaAddressToBytes32(liquidity.usdcAta);

    console.log("[cross-chain] mirror verify request", {
      sourceChain,
      txHash,
      recipientWallet,
      expectedAmountUsdc,
      solanaTreasuryOwner: liquidity.owner,
      solanaTreasuryAta: liquidity.usdcAta,
      expectedMintRecipient,
    });

    const { data: existing } = await supabase
      .from("cross_chain_payments")
      .select("id, status, dest_tx_signature, sender_address")
      .eq("source_tx_hash", txHash)
      .maybeSingle();

    if (existing?.status === "completed") {
      return { success: true, status: "completed", destTxSignature: existing.dest_tx_signature };
    }

    if (existing?.status === "processing_payout") {
      return pendingResponse("Treasury payout is already in progress.");
    }

    let record = existing;
    if (!record) {
      const { data, error: insertErr } = await supabase
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

      if (insertErr || !data) {
        throw new DatabaseConnectionError(insertErr?.message || "Failed to record cross-chain attempt");
      }

      record = data;
    }

    if (!record) {
      throw new DatabaseConnectionError("Failed to record cross-chain attempt");
    }

    try {
      let senderAddress = record.sender_address as string | undefined;

      if (record.status !== "verified") {
        const { receipt, transaction, rpcUrl } = await fetchEvmTransactionData(chainConfig, sourceChain, txHash);
        if (!receipt) {
          return pendingResponse(`Waiting for ${sourceChain} transaction confirmation.`);
        }

        if (receipt.status !== 1) {
          throw new Error("EVM transaction reverted");
        }
        if (receipt.to?.toLowerCase() !== chainConfig.tokenMessengerAddress.toLowerCase()) {
          throw new Error("Transaction was not sent to Circle TokenMessengerV2");
        }
        if (!transaction) {
          throw new Error(`Transaction not found on ${sourceChain}`);
        }

        const iface = new ethers.Interface(TOKEN_MESSENGER_ABI);
        const decoded = iface.parseTransaction({ data: transaction.data, value: transaction.value });
        if (!decoded || decoded.name !== "depositForBurn") {
          throw new Error("Transaction was not a Circle depositForBurn call");
        }

        const expectedValue = ethers.parseUnits(expectedAmountUsdc.toString(), 6);
        const inputAmount = decoded.args.amount as bigint;
        const inputDestinationDomain = decoded.args.destinationDomain;
        const inputMintRecipient = String(decoded.args.mintRecipient);
        const inputBurnToken = String(decoded.args.burnToken);
        const inputDestinationCaller = String(decoded.args.destinationCaller);

        if (
          inputBurnToken.toLowerCase() !== chainConfig.usdcAddress.toLowerCase() ||
          Number(inputDestinationDomain) !== SOLANA_DOMAIN ||
          inputMintRecipient.toLowerCase() !== expectedMintRecipient.toLowerCase() ||
          inputDestinationCaller.toLowerCase() !== DESTINATION_CALLER_ANY.toLowerCase() ||
          inputAmount < expectedValue
        ) {
          throw new Error("Transaction did not burn the required USDC to the configured Solana treasury through Circle CCTP");
        }

        senderAddress = receipt.from;

        console.log("[cross-chain] CCTP burn verified", {
          txHash,
          sourceChain,
          senderAddress,
          solanaTreasuryAta: liquidity.usdcAta,
          amountRaw: inputAmount.toString(),
          rpcUrl,
        });

        await supabase
          .from("cross_chain_payments")
          .update({
            status: "verified",
            sender_address: senderAddress,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", record.id);
      }

      await supabase
        .from("cross_chain_payments")
        .update({
          status: "processing_payout",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      const solanaSignature = await this.solanaService.executeBackendTransfer(
        recipientWallet,
        expectedAmountUsdc,
      );

      await recordMirroredPayment(
        senderAddress || txHash,
        recipientWallet,
        expectedAmountUsdc,
        solanaSignature,
      );

      await supabase
        .from("cross_chain_payments")
        .update({
          status: "completed",
          sender_address: senderAddress,
          dest_tx_signature: solanaSignature,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      console.log("[cross-chain] mirror payout completed", {
        txHash,
        solanaSignature,
        recipientWallet,
      });

      return { success: true, status: "completed", destTxSignature: solanaSignature };
    } catch (err: any) {
      console.error("[cross-chain] mirror verification/fulfillment failed", {
        txHash,
        sourceChain,
        recipientWallet,
        message: err.message || "Unknown error",
      });

      if (isRetryableNetworkError(err)) {
        await supabase
          .from("cross_chain_payments")
          .update({
            status: record.status === "verified" ? "verified" : "pending",
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", record.id);

        return pendingResponse("Network lookup is temporarily unavailable. Retrying shortly.");
      }

      await supabase
        .from("cross_chain_payments")
        .update({
          status: "failed",
          error_message: err.message || "Unknown error",
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      throw new CrossChainInputError(err.message || "Cross-chain fulfillment failed");
    }
  }

  private solanaAddressToBytes32(address: string) {
    return ethers.hexlify(new PublicKey(address).toBytes());
  }
}
