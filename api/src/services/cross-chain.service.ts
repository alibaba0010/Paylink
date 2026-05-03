import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { supabase, DatabaseConnectionError } from "../db/supabase-client";

export class CrossChainInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossChainInputError";
  }
}

const EVM_CHAINS: Record<string, {
  domain: number;
  rpcUrl: string;
  usdcAddress: string;
  tokenMessengerAddress: string;
}> = {
  sepolia: {
    domain: 0,
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessengerAddress: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  avalanche_fuji: {
    domain: 1,
    rpcUrl: process.env.AVALANCHE_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
    tokenMessengerAddress: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  }
};

const TOKEN_MESSENGER_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "event DepositForBurn(bytes32 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)"
];

const CIRCLE_IRIS_BASE_URL = process.env.CIRCLE_IRIS_BASE_URL || "https://iris-api-sandbox.circle.com";
const SOLANA_DOMAIN = 5;
const SOLANA_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DESTINATION_CALLER_ANY = ethers.ZeroHash;

type CircleMessage = {
  attestation?: string;
  message?: string;
  status?: string;
};

async function fetchCircleMessage(sourceDomain: number, txHash: string): Promise<CircleMessage | null> {
  try {
    console.log("[cross-chain] fetching Circle message", {
      sourceDomain,
      txHash,
      irisBaseUrl: CIRCLE_IRIS_BASE_URL,
    });
    const response = await fetch(
      `${CIRCLE_IRIS_BASE_URL}/v2/messages/${sourceDomain}?transactionHash=${txHash}`
    );

    console.log("[cross-chain] Circle message response", {
      sourceDomain,
      txHash,
      status: response.status,
      ok: response.ok,
    });

    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) {
      console.warn(`Circle attestation lookup failed with ${response.status}`);
      return null;
    }

    const data = await response.json() as { messages?: CircleMessage[] } | CircleMessage[];
    const message = Array.isArray(data) ? data[0] ?? null : data.messages?.[0] ?? null;
    console.log("[cross-chain] Circle message parsed", {
      sourceDomain,
      txHash,
      messageStatus: message?.status,
      hasAttestation: !!message?.attestation && message.attestation !== "PENDING",
      hasMessage: !!message?.message,
    });
    return message;
  } catch (error) {
    console.warn("Circle attestation lookup failed", error);
    return null;
  }
}

function pendingResponse(message: string) {
  return { success: true, status: "pending", message };
}

export class CrossChainService {

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
    const recipient = new PublicKey(recipientWallet);
    const expectedRecipientAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, recipient);
    const expectedMintRecipient = ethers.hexlify(expectedRecipientAta.toBytes());

    console.log("[cross-chain] verify request", {
      sourceChain,
      txHash,
      recipientWallet,
      expectedRecipientAta: expectedRecipientAta.toBase58(),
      expectedMintRecipient,
      expectedAmountUsdc,
    });

    // Check if we already processed this tx
    const { data: existing } = await supabase
      .from("cross_chain_payments")
      .select("id, status, dest_tx_signature")
      .eq("source_tx_hash", txHash)
      .maybeSingle();

    if (existing) {
      console.log("[cross-chain] existing payment record found", {
        id: existing.id,
        status: existing.status,
        hasDestTxSignature: !!existing.dest_tx_signature,
        txHash,
      });
      if (existing.status === 'completed') {
        return { success: true, status: "completed", destTxSignature: existing.dest_tx_signature };
      }
      if (existing.status === 'verified') {
        const circleMessage = await fetchCircleMessage(chainConfig.domain, txHash);
        const hasAttestation =
          circleMessage?.attestation &&
          circleMessage.attestation !== "PENDING" &&
          circleMessage.message;

        return pendingResponse(hasAttestation
          ? "CCTP burn and Circle attestation are ready. Solana receiveMessage relayer still needs to mint the USDC."
          : "CCTP burn verified. Waiting for Circle attestation before Solana mint.");
      }
    }

    // 1. Record the attempt
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
      console.log("[cross-chain] payment attempt recorded", {
        id: data.id,
        txHash,
        sourceChain,
        recipientWallet,
      });
    }
    if (!record) {
      throw new DatabaseConnectionError("Failed to record cross-chain attempt");
    }

    try {
      // 2. Verify CCTP burn transaction
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      console.log("[cross-chain] fetching EVM receipt", {
        sourceChain,
        txHash,
        rpcUrl: chainConfig.rpcUrl,
      });
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        throw new Error(`Transaction receipt not found on ${sourceChain}`);
      }
      console.log("[cross-chain] EVM receipt found", {
        txHash,
        status: receipt.status,
        from: receipt.from,
        to: receipt.to,
        blockNumber: receipt.blockNumber,
        logCount: receipt.logs.length,
      });
      
      if (receipt.status !== 1) {
        throw new Error("EVM Transaction reverted");
      }

      if (receipt.to?.toLowerCase() !== chainConfig.tokenMessengerAddress.toLowerCase()) {
        throw new Error("Transaction was not sent to Circle TokenMessengerV2");
      }

      const iface = new ethers.Interface(TOKEN_MESSENGER_ABI);
      const transaction = await provider.getTransaction(txHash);
      if (!transaction) {
        throw new Error(`Transaction not found on ${sourceChain}`);
      }

      const decoded = iface.parseTransaction({ data: transaction.data, value: transaction.value });
      if (!decoded || decoded.name !== "depositForBurn") {
        throw new Error("Transaction was not a Circle depositForBurn call");
      }

      const expectedValue = ethers.parseUnits(expectedAmountUsdc.toString(), 6);
      const inputAmount = decoded.args.amount;
      const inputDestinationDomain = decoded.args.destinationDomain;
      const inputMintRecipient = decoded.args.mintRecipient;
      const inputBurnToken = decoded.args.burnToken;
      const inputDestinationCaller = decoded.args.destinationCaller;
      console.log("[cross-chain] decoded depositForBurn input", {
        txHash,
        inputAmount: inputAmount.toString(),
        expectedValue: expectedValue.toString(),
        inputDestinationDomain: Number(inputDestinationDomain),
        inputMintRecipient,
        expectedMintRecipient,
        inputBurnToken,
        expectedBurnToken: chainConfig.usdcAddress,
        inputDestinationCaller,
      });
      if (
        inputBurnToken.toLowerCase() !== chainConfig.usdcAddress.toLowerCase() ||
        Number(inputDestinationDomain) !== SOLANA_DOMAIN ||
        inputMintRecipient.toLowerCase() !== expectedMintRecipient.toLowerCase() ||
        inputDestinationCaller.toLowerCase() !== DESTINATION_CALLER_ANY.toLowerCase() ||
        inputAmount < expectedValue
      ) {
        throw new Error("Transaction did not burn the required USDC to the expected Solana recipient through Circle CCTP");
      }

      let foundValidBurn = false;
      let senderAddress = receipt.from;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === chainConfig.tokenMessengerAddress.toLowerCase()) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed && parsed.name === "DepositForBurn") {
              const value = parsed.args.amount;
              const burnToken = parsed.args.burnToken;
              const destinationDomain = parsed.args.destinationDomain;
              const mintRecipient = parsed.args.mintRecipient;

              if (
                burnToken.toLowerCase() === chainConfig.usdcAddress.toLowerCase() &&
                Number(destinationDomain) === SOLANA_DOMAIN &&
                mintRecipient.toLowerCase() === expectedMintRecipient.toLowerCase() &&
                value >= expectedValue
              ) {
                foundValidBurn = true;
                console.log("[cross-chain] valid DepositForBurn event found", {
                  txHash,
                  value: value.toString(),
                  mintRecipient,
                  destinationDomain: Number(destinationDomain),
                });
                break;
              }
            }
          } catch (e) {
            // Ignore logs that don't match our ABI
          }
        }
      }

      if (!foundValidBurn) {
        console.warn(`Could not parse DepositForBurn event for ${txHash}; validated depositForBurn input instead.`);
      }

      // Mark as verified
      await supabase
        .from("cross_chain_payments")
        .update({ status: "verified", sender_address: senderAddress, error_message: null })
        .eq("id", record.id);

      const circleMessage = await fetchCircleMessage(chainConfig.domain, txHash);
      const hasAttestation =
        circleMessage?.attestation &&
        circleMessage.attestation !== "PENDING" &&
        circleMessage.message;
      console.log("[cross-chain] attestation status", {
        txHash,
        hasAttestation: !!hasAttestation,
        circleStatus: circleMessage?.status,
        hasMessage: !!circleMessage?.message,
      });

      if (!hasAttestation) {
        await supabase
          .from("cross_chain_payments")
          .update({
            status: "verified",
            error_message: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", record.id);

        return pendingResponse("CCTP burn verified. Waiting for Circle attestation before Solana mint.");
      }

      console.log("[cross-chain] burn verified but Solana mint not executed", {
        txHash,
        recipientWallet,
        expectedRecipientAta: expectedRecipientAta.toBase58(),
      });
      return pendingResponse("CCTP burn and Circle attestation are ready. Solana receiveMessage relayer still needs to mint the USDC.");
    } catch (err: any) {
      console.error("[cross-chain] verification failed", {
        txHash,
        sourceChain,
        recipientWallet,
        message: err.message || "Unknown error",
      });
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
