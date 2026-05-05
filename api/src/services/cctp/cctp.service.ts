import { ethers } from "ethers";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { supabase, DatabaseConnectionError } from "../../db/supabase-client";

export class CrossChainInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossChainInputError";
  }
}

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

// CCTP V2 program IDs on Solana (same for devnet and mainnet)
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
const TOKEN_MESSENGER_MINTER_PROGRAM_ID = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");

type CircleMessage = {
  attestation?: string;
  message?: string;
  status?: string;
};

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
      console.log("[cross-chain] fetching EVM receipt", {
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

/**
 * Poll Circle's IRIS API until the attestation is ready, or timeout.
 */
async function waitForAttestation(sourceDomain: number, txHash: string, maxWaitMs = 15_000): Promise<{ message: string; attestation: string } | null> {
  const start = Date.now();
  const pollInterval = 5_000; // 5 seconds

  console.log("[cross-chain] waiting for Circle attestation", { sourceDomain, txHash, maxWaitMs });

  while (Date.now() - start < maxWaitMs) {
    const circleMsg = await fetchCircleMessage(sourceDomain, txHash);

    if (
      circleMsg?.attestation &&
      circleMsg.attestation !== "PENDING" &&
      circleMsg.message
    ) {
      console.log("[cross-chain] attestation received!", {
        txHash,
        attestationLength: circleMsg.attestation.length,
        messageLength: circleMsg.message.length,
      });
      return {
        message: circleMsg.message,
        attestation: circleMsg.attestation,
      };
    }

    console.log("[cross-chain] attestation not ready yet, polling again in", pollInterval, "ms", {
      txHash,
      elapsed: Date.now() - start,
      status: circleMsg?.status,
    });
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}

// ── Solana receiveMessage helpers ──────────────────────────────────────────

/**
 * Derive PDAs needed for calling receiveMessage on Solana's CCTP MessageTransmitter.
 */
function deriveMessageTransmitterState(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );
  return pda;
}

function deriveAuthorityPda(receiverProgramId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter_authority"), receiverProgramId.toBuffer()],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );
  return pda;
}

function deriveUsedNoncesPda(sourceDomain: number, nonce: bigint): PublicKey {
  // The first_nonce for a UsedNonces account groups 6400 nonces together
  const NONCES_PER_ACCOUNT = BigInt(6400);
  const firstNonce = nonce - ((nonce - BigInt(1)) % NONCES_PER_ACCOUNT);

  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("used_nonces"),
      Buffer.from(sourceDomain.toString()),
      Buffer.from("/"),
      Buffer.from(firstNonce.toString()),
    ],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );
  return pda;
}

function deriveTokenMessengerState(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveRemoteTokenMessenger(remoteDomain: number): PublicKey {
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(remoteDomain);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainBuffer],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveTokenMinterState(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveLocalToken(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), mint.toBuffer()],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveTokenPair(remoteDomain: number, remoteTokenBytes: Buffer): PublicKey {
  const domainBuffer = Buffer.alloc(4);
  domainBuffer.writeUInt32LE(remoteDomain);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_pair"), domainBuffer, remoteTokenBytes],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveCustodyTokenAccount(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("custody"), mint.toBuffer()],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveTokenMessengerEventAuthority(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  );
  return pda;
}

function deriveMessageTransmitterEventAuthority(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );
  return pda;
}

/**
 * Parse the nonce from a CCTP V2 message bytes.
 * Message format: version(4) + sourceDomain(4) + destinationDomain(4) + nonce(8) + ...
 * V2 nonces are uint64 (8 bytes) starting at offset 12.
 */
function parseNonceFromMessage(messageHex: string): bigint {
  const msgBytes = Buffer.from(messageHex.replace("0x", ""), "hex");
  // V2 message layout: version(4) + sourceDomain(4) + destinationDomain(4) + nonce(8)
  // The nonce in V2 is 8 bytes at offset 12
  if (msgBytes.length < 20) {
    throw new Error("Message too short to contain a nonce");
  }
  return msgBytes.readBigUInt64BE(12);
}

/**
 * Parse the source domain from the CCTP message.
 */
function parseSourceDomainFromMessage(messageHex: string): number {
  const msgBytes = Buffer.from(messageHex.replace("0x", ""), "hex");
  return msgBytes.readUInt32BE(4);
}

/**
 * Build the Anchor instruction discriminator for `receive_message`.
 */
function receiveMessageDiscriminator(): Buffer {
  // Anchor uses sha256("global:receive_message")[0..8]
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256")
    .update("global:receive_message")
    .digest();
  return hash.subarray(0, 8);
}

/**
 * Build the receiveMessage instruction for Solana's CCTP MessageTransmitter.
 */
function buildReceiveMessageInstruction(
  payer: PublicKey,
  messageBytes: Buffer,
  attestationBytes: Buffer,
  sourceDomain: number,
  nonce: bigint,
  recipientAta: PublicKey,
  remoteUsdcAddress: Buffer, // 32-byte remote USDC address
): TransactionInstruction {
  const messageTransmitterState = deriveMessageTransmitterState();
  const authorityPda = deriveAuthorityPda(TOKEN_MESSENGER_MINTER_PROGRAM_ID);
  const usedNonces = deriveUsedNoncesPda(sourceDomain, nonce);
  const receiver = TOKEN_MESSENGER_MINTER_PROGRAM_ID;

  // Token Messenger Minter accounts (passed as remaining accounts)
  const tokenMessenger = deriveTokenMessengerState();
  const remoteTokenMessenger = deriveRemoteTokenMessenger(sourceDomain);
  const tokenMinter = deriveTokenMinterState();
  const localToken = deriveLocalToken(SOLANA_USDC_MINT);
  const tokenPair = deriveTokenPair(sourceDomain, remoteUsdcAddress);
  const custodyTokenAccount = deriveCustodyTokenAccount(SOLANA_USDC_MINT);
  const tokenMessengerEventAuthority = deriveTokenMessengerEventAuthority();
  const messageTransmitterEventAuthority = deriveMessageTransmitterEventAuthority();

  console.log("[cross-chain] receiveMessage PDAs", {
    messageTransmitterState: messageTransmitterState.toBase58(),
    authorityPda: authorityPda.toBase58(),
    usedNonces: usedNonces.toBase58(),
    receiver: receiver.toBase58(),
    tokenMessenger: tokenMessenger.toBase58(),
    remoteTokenMessenger: remoteTokenMessenger.toBase58(),
    tokenMinter: tokenMinter.toBase58(),
    localToken: localToken.toBase58(),
    tokenPair: tokenPair.toBase58(),
    custodyTokenAccount: custodyTokenAccount.toBase58(),
    recipientAta: recipientAta.toBase58(),
    usdcMint: SOLANA_USDC_MINT.toBase58(),
  });

  // Build instruction data: discriminator + params (message Vec<u8> + attestation Vec<u8>)
  const disc = receiveMessageDiscriminator();

  // Borsh-encode Vec<u8>: 4-byte little-endian length prefix + raw bytes
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32LE(messageBytes.length);

  const attLenBuf = Buffer.alloc(4);
  attLenBuf.writeUInt32LE(attestationBytes.length);

  const data = Buffer.concat([
    disc,
    msgLenBuf, messageBytes,
    attLenBuf, attestationBytes,
  ]);

  // Account metas for the receiveMessage instruction
  const keys = [
    // Core MessageTransmitter accounts
    { pubkey: payer, isSigner: true, isWritable: true },        // payer
    { pubkey: payer, isSigner: true, isWritable: false },       // caller
    { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
    { pubkey: messageTransmitterState, isSigner: false, isWritable: false }, // message_transmitter
    { pubkey: usedNonces, isSigner: false, isWritable: true },  // used_nonces
    { pubkey: receiver, isSigner: false, isWritable: false },   // receiver (TokenMessengerMinter)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program

    // Remaining accounts for TokenMessengerMinter's handleReceiveMessage
    { pubkey: tokenMessenger, isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
    { pubkey: tokenMinter, isSigner: false, isWritable: false },
    { pubkey: localToken, isSigner: false, isWritable: true },
    { pubkey: tokenPair, isSigner: false, isWritable: false },
    { pubkey: recipientAta, isSigner: false, isWritable: true },     // mint recipient token account
    { pubkey: custodyTokenAccount, isSigner: false, isWritable: true }, // custody
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenMessengerEventAuthority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_MINTER_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: messageTransmitterEventAuthority, isSigner: false, isWritable: false },
    { pubkey: MESSAGE_TRANSMITTER_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: MESSAGE_TRANSMITTER_PROGRAM_ID,
    keys,
    data,
  });
}

function pendingResponse(message: string) {
  return { success: true, status: "pending", message };
}

export class CrossChainService {

  /**
   * Verify an EVM transaction and complete the CCTP transfer on Solana.
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
      .select("id, status, dest_tx_signature, sender_address")
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
      // If verified but not completed, continue to attempt the Solana mint
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
      if (record.status !== "verified") {
        // 2. Verify CCTP burn transaction
        const { receipt, transaction, rpcUrl } = await fetchEvmTransactionData(chainConfig, sourceChain, txHash);

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
          rpcUrl,
        });
        
        if (receipt.status !== 1) {
          throw new Error("EVM Transaction reverted");
        }

        if (receipt.to?.toLowerCase() !== chainConfig.tokenMessengerAddress.toLowerCase()) {
          throw new Error("Transaction was not sent to Circle TokenMessengerV2");
        }

        const iface = new ethers.Interface(TOKEN_MESSENGER_ABI);
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

        // Mark as verified
        await supabase
          .from("cross_chain_payments")
          .update({ status: "verified", sender_address: receipt.from, error_message: null })
          .eq("id", record.id);
      } else {
        console.log("[cross-chain] burn already verified, skipping EVM receipt re-check", {
          txHash,
          sourceChain,
          paymentId: record.id,
        });
      }

      console.log("[cross-chain] burn verified, waiting for attestation...");

      // 3. Wait for Circle attestation
      const attestationResult = await waitForAttestation(chainConfig.domain, txHash);
      
      if (!attestationResult) {
        console.log("[cross-chain] attestation still pending, returning to client to retry");
        return { success: true, status: "pending", message: "Waiting for Circle attestation. The transfer will complete once Circle processes it." };
      }

      const { message: cctpMessage, attestation } = attestationResult;

      // 4. Call receiveMessage on Solana to mint USDC to the recipient
      const solanaSignature = await this.executeReceiveMessageOnSolana(
        cctpMessage,
        attestation,
        chainConfig.domain,
        chainConfig.usdcAddress,
        expectedRecipientAta,
        recipient,
      );

      // 5. Mark as completed
      await supabase
        .from("cross_chain_payments")
        .update({
          status: "completed",
          dest_tx_signature: solanaSignature,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      console.log("[cross-chain] CCTP transfer completed!", {
        txHash,
        solanaSignature,
        recipientWallet,
      });

      return { success: true, status: "completed", destTxSignature: solanaSignature };

    } catch (err: any) {
      console.error("[cross-chain] verification/fulfillment failed", {
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
            updated_at: new Date().toISOString()
          })
          .eq("id", record.id);

        return pendingResponse("Network lookup is temporarily unavailable. Retrying shortly.");
      }

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

  /**
   * Build and submit the receiveMessage transaction on Solana to mint USDC.
   */
  private async executeReceiveMessageOnSolana(
    cctpMessageHex: string,
    attestationHex: string,
    sourceDomain: number,
    remoteUsdcAddressHex: string,
    recipientAta: PublicKey,
    recipientWalletOwner: PublicKey,
  ): Promise<string> {
    const bs58 = require("bs58");
    const decode = bs58.decode || (bs58.default && bs58.default.decode) || bs58;

    if (!process.env.FEE_PAYER_PRIVATE_KEY) {
      throw new Error("FEE_PAYER_PRIVATE_KEY not configured — cannot submit receiveMessage on Solana");
    }

    const feePayer = Keypair.fromSecretKey(decode(process.env.FEE_PAYER_PRIVATE_KEY));
    const connection = new Connection(
      process.env.HELIUS_RPC_URL || "https://api.devnet.solana.com",
      "confirmed"
    );

    console.log("[cross-chain] executing receiveMessage on Solana", {
      feePayer: feePayer.publicKey.toBase58(),
      recipientAta: recipientAta.toBase58(),
      recipientOwner: recipientWalletOwner.toBase58(),
      sourceDomain,
    });

    // Parse the nonce from the CCTP message
    const nonce = parseNonceFromMessage(cctpMessageHex);
    console.log("[cross-chain] parsed nonce from message", { nonce: nonce.toString() });

    const messageBytes = Buffer.from(cctpMessageHex.replace("0x", ""), "hex");
    const attestationBytes = Buffer.from(attestationHex.replace("0x", ""), "hex");

    // Convert the remote USDC address (EVM) to a 32-byte buffer
    const remoteUsdcBytes = Buffer.alloc(32);
    const cleanAddr = remoteUsdcAddressHex.replace("0x", "");
    Buffer.from(cleanAddr, "hex").copy(remoteUsdcBytes, 32 - cleanAddr.length / 2);

    const tx = new Transaction();

    // Ensure the recipient's USDC ATA exists
    const ataInfo = await connection.getAccountInfo(recipientAta);
    if (!ataInfo) {
      console.log("[cross-chain] creating recipient ATA", {
        ata: recipientAta.toBase58(),
        owner: recipientWalletOwner.toBase58(),
      });
      tx.add(
        createAssociatedTokenAccountInstruction(
          feePayer.publicKey,
          recipientAta,
          recipientWalletOwner,
          SOLANA_USDC_MINT,
        )
      );
    }

    // Build the receiveMessage instruction
    const receiveIx = buildReceiveMessageInstruction(
      feePayer.publicKey,
      messageBytes,
      attestationBytes,
      sourceDomain,
      nonce,
      recipientAta,
      remoteUsdcBytes,
    );
    tx.add(receiveIx);

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer.publicKey;
    tx.sign(feePayer);

    console.log("[cross-chain] submitting receiveMessage transaction...");
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log("[cross-chain] receiveMessage submitted", { signature: sig });

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(sig, "confirmed");
    if (confirmation.value.err) {
      throw new Error(`Solana receiveMessage failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log("[cross-chain] receiveMessage confirmed!", { signature: sig });
    return sig;
  }
}
