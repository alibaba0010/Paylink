import {
  ComputeBudgetProgram, Connection, PublicKey, SendTransactionError, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction,
  type ParsedTransactionMeta,
} from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createTransferInstruction, createAssociatedTokenAccountInstruction, getAccount
} from '@solana/spl-token';
import idl from '../idl/paylink.json';
type PayLink = any;

const DEFAULT_PAYLINK_PROGRAM_ID = 'CsWFkhdvqgVr9oVJXQUogTYTEDNPGmA3gAb1HmsH8AsX';

export class SolanaService {
  private connection: Connection;
  private program: any;
  private programId: PublicKey;

  // USDC mint on Solana Devnet (Provided by User)
  private USDC_MINT = new PublicKey(
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  );

  constructor() {
    this.connection = new Connection(
      process.env.HELIUS_RPC_URL!,
      'confirmed'
    );
    this.programId = new PublicKey(
      process.env.PAYLINK_PROGRAM_ID || DEFAULT_PAYLINK_PROGRAM_ID
    );
    // Read-only provider for building (employer signs client-side)
    const provider = new AnchorProvider(this.connection, {} as any, {});
    this.program = new Program(
      { ...(idl as any), address: this.programId.toBase58() } as PayLink,
      provider
    );
  }

  /**
   * Build an unsigned deposit_escrow transaction.
   * Returns base64 — employer signs it in the browser.
   */
  async buildDepositTransaction(
    employerPubkey: string,
    workerPubkey:   string,
    amountUSDC:     number,   // human units e.g. 100.50
    unlockTime:     number,   // Unix timestamp; 0 = immediate
  ): Promise<string> {
    const employer = new PublicKey(employerPubkey);
    const worker   = new PublicKey(workerPubkey);
    const tx = new Transaction();
    const instructions = await this.buildDepositEscrowInstructions(
      employer,
      worker,
      amountUSDC,
      unlockTime,
      BigInt(unlockTime),
    );

    for (const instruction of instructions) {
      tx.add(instruction);
    }

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer        = employer;

    // Serialize without requiring all signatures (employer signs in browser)
    return Buffer.from(
      tx.serialize({ requireAllSignatures: false })
    ).toString('base64');
  }

  /**
   * Build chunked escrow-funding transactions for a payroll cycle.
   * Each transaction contains a small batch of per-recipient deposit instructions.
   */
  async buildBulkEscrowDepositTransactions(
    senderPubkey: string,
    recipients: { wallet_address: string; amount_usdc: number }[],
    unlockTime: number,
  ): Promise<string[]> {
    const sender = new PublicKey(senderPubkey);
    const transactionsBase64: string[] = [];
    const CHUNK_SIZE = 2;

    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const tx = new Transaction();

      // Escrow deposits are compute-heavy because each instruction may create
      // PDA-backed accounts and perform token CPIs.
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 400_000,
        }),
      );

      for (const recipient of chunk) {
        const worker = new PublicKey(recipient.wallet_address);
        const instructions = await this.buildDepositEscrowInstructions(
          sender,
          worker,
          recipient.amount_usdc,
          unlockTime,
          BigInt(unlockTime),
        );

        for (const instruction of instructions) tx.add(instruction);
      }

      if (tx.instructions.length === 1) continue;

      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender;

      transactionsBase64.push(
        Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64')
      );
    }

    return transactionsBase64;
  }

  async verifyBulkEscrowDeposits(
    senderPubkey: string,
    recipients: { wallet_address: string; amount_usdc: number }[],
    unlockTime: number,
  ): Promise<boolean> {
    const sender = new PublicKey(senderPubkey);

    for (const recipient of recipients) {
      const worker = new PublicKey(recipient.wallet_address);
      const workerUsdcATA = await getAssociatedTokenAddress(this.USDC_MINT, worker);
      const expectedAmount = BigInt(Math.round(recipient.amount_usdc * 1_000_000));

      const cycleEscrowState = await this.getCycleEscrowState(sender, workerUsdcATA, BigInt(unlockTime));
      const legacyEscrowState = await this.getLegacyEscrowState(sender, workerUsdcATA);
      if (!this.matchesFundedEscrow(cycleEscrowState ?? legacyEscrowState, expectedAmount, unlockTime)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Build a direct USDC transfer transaction (no escrow).
   */
  async buildDirectTransferTransaction(
    senderPubkey:    string,
    recipientPubkey: string,
    amountUSDC:      number,
  ): Promise<string> {
    const sender    = new PublicKey(senderPubkey);
    const recipient = new PublicKey(recipientPubkey);
    const amount    = BigInt(Math.round(amountUSDC * 1_000_000));

    const senderATA    = await getAssociatedTokenAddress(this.USDC_MINT, sender);
    const recipientATA = await getAssociatedTokenAddress(this.USDC_MINT, recipient);

    const tx = new Transaction();

    // 1. Check if recipient ATA exists
    const recipientInfo = await this.connection.getAccountInfo(recipientATA);
    if (!recipientInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          sender,       // payer
          recipientATA, // ata
          recipient,    // owner
          this.USDC_MINT
        )
      );
    }

    // 2. Add the transfer instruction
    tx.add(
      createTransferInstruction(
        senderATA,
        recipientATA,
        sender,
        amount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer        = sender;

    return Buffer.from(
      tx.serialize({ requireAllSignatures: false })
    ).toString('base64');
  }

  /**
   * Build bulk direct USDC transfer transactions (no escrow), chunked by 10 recipients per tx.
   */
  async buildBulkDirectTransferTransactions(
    senderPubkey: string,
    recipients: { wallet_address: string; amount_usdc: number }[],
  ): Promise<string[]> {
    const sender = new PublicKey(senderPubkey);
    const senderATA = await getAssociatedTokenAddress(this.USDC_MINT, sender);
    
    const CHUNK_SIZE = 10;
    const transactionsBase64: string[] = [];

    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const tx = new Transaction();

      // Optimize: we can batch ATA checks or just do them sequentially
      for (const r of chunk) {
        const recipient = new PublicKey(r.wallet_address);
        const amount = BigInt(Math.round(r.amount_usdc * 1_000_000));
        const recipientATA = await getAssociatedTokenAddress(this.USDC_MINT, recipient);
        
        const recipientInfo = await this.connection.getAccountInfo(recipientATA);
        if (!recipientInfo) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              sender,
              recipientATA,
              recipient,
              this.USDC_MINT
            )
          );
        }
        
        tx.add(
          createTransferInstruction(
            senderATA,
            recipientATA,
            sender,
            amount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }

      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender;

      transactionsBase64.push(
        Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64')
      );
    }

    return transactionsBase64;
  }

  /**
   * Submit a signed transaction from the browser and confirm it.
   */
  async confirmTransaction(signedTxBase64: string): Promise<string> {
    const tx = Transaction.from(Buffer.from(signedTxBase64, 'base64'));
    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }

  async verifyDirectUsdcTransfer(
    signature: string,
    senderWallet: string,
    recipientWallet: string,
    amountUSDC: number,
  ): Promise<void> {
    const sender = new PublicKey(senderWallet);
    const recipient = new PublicKey(recipientWallet);
    const expectedAmount = BigInt(Math.round(amountUSDC * 1_000_000));

    const parsedTransaction = await this.waitForParsedTransaction(signature);
    if (!parsedTransaction) {
      throw new Error("Transaction was not found on Solana yet. Wait a moment and confirm again.");
    }

    if (parsedTransaction.meta?.err) {
      throw new Error(`Transaction failed on Solana: ${JSON.stringify(parsedTransaction.meta.err)}`);
    }

    const senderSigned = parsedTransaction.transaction.message.accountKeys.some(account =>
      account.pubkey.equals(sender) && account.signer
    );
    if (!senderSigned) {
      throw new Error("Transaction was not signed by the expected sender wallet.");
    }

    const receivedAmount = this.getTokenBalanceDeltaForOwner(
      parsedTransaction.meta,
      recipient,
      this.USDC_MINT,
    );

    if (receivedAmount < expectedAmount) {
      throw new Error(
        `Recipient did not receive the expected USDC amount. Expected ${expectedAmount.toString()} raw units, received ${receivedAmount.toString()}.`,
      );
    }
  }

  /**
   * Build a create_payment_link transaction for a worker.
   */
  async buildCreateLinkTransaction(
    ownerPubkey:  string,
    linkId:       string,
    amountUSDC:   number,   // 0 = open amount
    isRecurring:  boolean,
    memo:         string,
  ): Promise<string> {
    const owner  = new PublicKey(ownerPubkey);
    const amount = new BN(Math.round(amountUSDC * 1_000_000));

    const [linkPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('paylink'), owner.toBuffer(), Buffer.from(linkId)],
      this.program.programId
    );

    const tx = await this.program.methods
      .createPaymentLink(linkId, amount, isRecurring, memo)
      .accounts({ payment_link: linkPDA, owner, systemProgram: SystemProgram.programId })
      .transaction();

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer        = owner;
    return Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');
  }

  /**
   * Build a gasless claim transaction sponsored by the server.
   */
  async buildGaslessClaimEscrow(
    employerPubkey: string,
    workerPubkey: string,
    unlockTime: number,
  ): Promise<string> {
    const bs58 = require('bs58');
    const decode = bs58.decode || (bs58.default && bs58.default.decode) || bs58;
    const { Keypair } = require('@solana/web3.js');
    
    if (!process.env.FEE_PAYER_PRIVATE_KEY) {
      throw new Error("FEE_PAYER_PRIVATE_KEY not configured on server.");
    }

    const feePayer = Keypair.fromSecretKey(decode(process.env.FEE_PAYER_PRIVATE_KEY));
    const employer = new PublicKey(employerPubkey);
    const worker = new PublicKey(workerPubkey);
    
    const workerUsdcATA = await getAssociatedTokenAddress(this.USDC_MINT, worker);
    const escrowId = BigInt(unlockTime);

    const [escrowPDA] = this.findEscrowPDA(employer, workerUsdcATA, escrowId);
    const [escrowVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), escrowPDA.toBuffer()],
      this.program.programId
    );

    const tx = new Transaction();

    const workerUsdcInfo = await this.connection.getAccountInfo(workerUsdcATA);
    if (!workerUsdcInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          feePayer.publicKey,
          workerUsdcATA,
          worker,
          this.USDC_MINT
        )
      );
    }

    const claimInstruction = await this.program.methods
      .claimPayment(new BN(escrowId.toString()))
      .accounts({
        escrow: escrowPDA,
        worker,
        escrowVault,
        workerUsdc: workerUsdcATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    tx.add(claimInstruction);

    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer.publicKey;

    tx.sign(feePayer);

    return Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');
  }

  /**
   * Execute a direct transfer using the backend's funded wallet (for cross-chain payouts).
   * It relies on BACKEND_SOLANA_PRIVATE_KEY in the env.
   */
  async getBackendTreasuryStatus(requiredAmountUSDC = 0) {
    const backendKeypair = this.getBackendKeypair();
    const usdcAta = await getAssociatedTokenAddress(this.USDC_MINT, backendKeypair.publicKey);
    const requiredAmountRaw = BigInt(Math.round(requiredAmountUSDC * 1_000_000));
    let balanceRaw = BigInt(0);
    let tokenAccountExists = false;

    try {
      balanceRaw = await this.getUsdcTokenAccountAmount(
        usdcAta,
        backendKeypair.publicKey,
        "backend treasury",
      );
      tokenAccountExists = true;
    } catch (error: any) {
      const message = String(error?.message || error || "");
      if (!message.includes("does not exist")) throw error;
    }

    return {
      owner: backendKeypair.publicKey.toBase58(),
      usdcAta: usdcAta.toBase58(),
      usdcMint: this.USDC_MINT.toBase58(),
      balanceRaw: balanceRaw.toString(),
      balanceUsdc: Number(balanceRaw) / 1_000_000,
      requiredAmountRaw: requiredAmountRaw.toString(),
      hasSufficientLiquidity: tokenAccountExists && balanceRaw >= requiredAmountRaw,
      tokenAccountExists,
    };
  }

  async executeBackendTransfer(
    recipientPubkey: string,
    amountUSDC: number
  ): Promise<string> {
    try {
      const backendKeypair = this.getBackendKeypair();
      
      const recipient = new PublicKey(recipientPubkey);
      const amount = BigInt(Math.round(amountUSDC * 1_000_000));

      const senderATA = await getAssociatedTokenAddress(this.USDC_MINT, backendKeypair.publicKey);
      const recipientATA = await getAssociatedTokenAddress(this.USDC_MINT, recipient);

      const tx = new Transaction();

      const treasuryBalance = await this.getUsdcTokenAccountAmount(
        senderATA,
        backendKeypair.publicKey,
        "backend treasury",
      );
      if (treasuryBalance < amount) {
        throw new Error(
          `Backend Solana treasury has insufficient USDC. Treasury owner ${backendKeypair.publicKey.toBase58()}, ATA ${senderATA.toBase58()}, balance ${treasuryBalance.toString()} raw units, required ${amount.toString()} raw units.`
        );
      }

      const recipientInfo = await this.connection.getAccountInfo(recipientATA);
      if (!recipientInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            backendKeypair.publicKey,
            recipientATA,
            recipient,
            this.USDC_MINT
          )
        );
      } else {
        await this.assertUsdcTokenAccount(
          recipientATA,
          recipient,
          "recipient",
        );
      }

      tx.add(
        createTransferInstruction(
          senderATA,
          recipientATA,
          backendKeypair.publicKey,
          amount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.feePayer = backendKeypair.publicKey;

      tx.sign(backendKeypair);

      const sig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(sig, 'confirmed');
      return sig;
    } catch (error) {
      const logs = await this.getSendTransactionLogs(error);
      console.error("Backend transfer failed:", {
        message: error instanceof Error ? error.message : String(error),
        logs,
      });
      throw error;
    }
  }

  private async buildDepositEscrowInstructions(
    employer: PublicKey,
    worker: PublicKey,
    amountUSDC: number,
    unlockTime: number,
    escrowId: bigint,
  ): Promise<TransactionInstruction[]> {
    const amount = new BN(Math.round(amountUSDC * 1_000_000));
    const instructions: TransactionInstruction[] = [];

    const employerUSDC = await getAssociatedTokenAddress(this.USDC_MINT, employer);
    const workerUsdcATA = await getAssociatedTokenAddress(this.USDC_MINT, worker);

    const workerUsdcInfo = await this.connection.getAccountInfo(workerUsdcATA);
    if (!workerUsdcInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          employer,
          workerUsdcATA,
          worker,
          this.USDC_MINT
        )
      );
    }

    const [escrowPDA] = this.findEscrowPDA(employer, workerUsdcATA, escrowId);

    const existingEscrowState = await this.getCycleEscrowState(employer, workerUsdcATA, escrowId);
    if (existingEscrowState) {
      if (this.matchesFundedEscrow(existingEscrowState, BigInt(amount.toString()), unlockTime)) {
        return instructions;
      }

      throw new Error(
        `Escrow account ${escrowPDA.toBase58()} already exists with different funding details. Use a new cycle date or verify the existing escrow before retrying.`,
      );
    }

    const legacyState = await this.getLegacyEscrowState(employer, workerUsdcATA);
    if (legacyState && !legacyState.isClaimed) {
      if (this.matchesFundedEscrow(legacyState, BigInt(amount.toString()), unlockTime)) {
        return instructions;
      }

      throw new Error(
        `Legacy escrow account ${legacyState.address} already holds funds for this worker. Refund, claim, or migrate that escrow before funding the next cycle.`,
      );
    }

    const [escrowVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), escrowPDA.toBuffer()],
      this.program.programId
    );

    const depositInstruction = await this.program.methods
      .depositEscrow(worker, new BN(escrowId.toString()), amount, new BN(unlockTime))
      .accounts({
        escrow: escrowPDA,
        employer,
        employerUsdc: employerUSDC,
        escrowVault,
        workerUsdc: workerUsdcATA,
        usdcMint: this.USDC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    instructions.push(depositInstruction);
    return instructions;
  }

  private async waitForParsedTransaction(signature: string) {
    const deadline = Date.now() + 45_000;

    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      if (status.value?.err) {
        throw new Error(`Transaction failed on Solana: ${JSON.stringify(status.value.err)}`);
      }

      const parsedTransaction = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (parsedTransaction) return parsedTransaction;

      await new Promise(resolve => setTimeout(resolve, 1_500));
    }

    return null;
  }

  private getTokenBalanceDeltaForOwner(
    meta: ParsedTransactionMeta | null | undefined,
    owner: PublicKey,
    mint: PublicKey,
  ): bigint {
    const ownerAddress = owner.toBase58();
    const mintAddress = mint.toBase58();

    const sumBalances = (balances: ParsedTransactionMeta['preTokenBalances'] | undefined) =>
      (balances ?? []).reduce((total, balance) => {
        if (balance.owner !== ownerAddress || balance.mint !== mintAddress) return total;
        return total + BigInt(balance.uiTokenAmount.amount);
      }, BigInt(0));

    return sumBalances(meta?.postTokenBalances) - sumBalances(meta?.preTokenBalances);
  }

  private async getUsdcTokenAccountAmount(
    tokenAccount: PublicKey,
    expectedOwner: PublicKey,
    label: string,
  ): Promise<bigint> {
    const account = await this.assertUsdcTokenAccount(tokenAccount, expectedOwner, label);
    return account.amount;
  }

  private async assertUsdcTokenAccount(
    tokenAccount: PublicKey,
    expectedOwner: PublicKey,
    label: string,
  ) {
    try {
      const account = await getAccount(
        this.connection,
        tokenAccount,
        "confirmed",
        TOKEN_PROGRAM_ID,
      );

      if (!account.owner.equals(expectedOwner)) {
        throw new Error(
          `${label} USDC token account owner mismatch. Account ${tokenAccount.toBase58()} is owned by ${account.owner.toBase58()}, expected ${expectedOwner.toBase58()}.`
        );
      }

      if (!account.mint.equals(this.USDC_MINT)) {
        throw new Error(
          `${label} token account mint mismatch. Account ${tokenAccount.toBase58()} uses mint ${account.mint.toBase58()}, expected USDC mint ${this.USDC_MINT.toBase58()}.`
        );
      }

      return account;
    } catch (error: any) {
      const message = String(error?.message || error || "");
      if (
        message.includes("could not find account") ||
        message.includes("TokenAccountNotFoundError")
      ) {
        throw new Error(
          `${label} USDC associated token account does not exist. Owner ${expectedOwner.toBase58()}, expected ATA ${tokenAccount.toBase58()}, mint ${this.USDC_MINT.toBase58()}. Fund/create this account before retrying cross-chain payout.`
        );
      }

      if (
        message.includes("Invalid account owner") ||
        message.includes("TokenInvalidAccountOwnerError")
      ) {
        throw new Error(
          `${label} USDC associated token account ${tokenAccount.toBase58()} exists but is not owned by the SPL Token program.`
        );
      }

      throw error;
    }
  }

  private async getSendTransactionLogs(error: unknown): Promise<string[] | undefined> {
    if (error instanceof SendTransactionError) {
      return error.getLogs(this.connection);
    }

    const maybeError = error as { getLogs?: (connection: Connection) => Promise<string[]> };
    if (typeof maybeError?.getLogs === "function") {
      return maybeError.getLogs(this.connection);
    }

    return undefined;
  }

  private getBackendKeypair() {
    const bs58 = require('bs58');
    const decode = bs58.decode || (bs58.default && bs58.default.decode) || bs58;
    const { Keypair } = require('@solana/web3.js');

    if (!process.env.BACKEND_SOLANA_PRIVATE_KEY) {
      throw new Error("BACKEND_SOLANA_PRIVATE_KEY not configured on server.");
    }

    return Keypair.fromSecretKey(decode(process.env.BACKEND_SOLANA_PRIVATE_KEY));
  }

  private u64SeedBuffer(value: bigint): Buffer {
    const seed = Buffer.alloc(8);
    seed.writeBigUInt64LE(value);
    return seed;
  }

  private findEscrowPDA(employer: PublicKey, workerUsdcATA: PublicKey, escrowId: bigint): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('escrow'),
        employer.toBuffer(),
        workerUsdcATA.toBuffer(),
        this.u64SeedBuffer(escrowId),
      ],
      this.program.programId,
    );
  }

  private async getCycleEscrowState(
    employer: PublicKey,
    workerUsdcATA: PublicKey,
    escrowId: bigint,
  ): Promise<{ address: string; amount: bigint; unlockTime: bigint; isClaimed: boolean } | null> {
    const [escrowPDA] = this.findEscrowPDA(employer, workerUsdcATA, escrowId);
    const account = await this.connection.getAccountInfo(escrowPDA);
    const state = account ? this.decodeEscrowAccount(account.data) : null;
    return state ? { address: escrowPDA.toBase58(), ...state } : null;
  }

  private async getLegacyEscrowState(
    employer: PublicKey,
    workerUsdcATA: PublicKey,
  ): Promise<{ address: string; amount: bigint; unlockTime: bigint; isClaimed: boolean } | null> {
    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), employer.toBuffer(), workerUsdcATA.toBuffer()],
      this.program.programId,
    );
    const account = await this.connection.getAccountInfo(escrowPDA);
    const state = account ? this.decodeLegacyEscrowAccount(account.data) : null;
    return state ? { address: escrowPDA.toBase58(), ...state } : null;
  }

  private matchesFundedEscrow(
    state: { amount: bigint; unlockTime: bigint; isClaimed: boolean } | null,
    expectedAmount: bigint,
    unlockTime: number,
  ): boolean {
    return !!state &&
      state.amount === expectedAmount &&
      state.unlockTime === BigInt(unlockTime) &&
      !state.isClaimed;
  }

  private decodeEscrowAccount(data: Buffer): { amount: bigint; unlockTime: bigint; isClaimed: boolean } | null {
    const minEscrowAccountLength = 8 + 32 + 32 + 8 + 8 + 8 + 1;
    if (data.length < minEscrowAccountLength) return null;

    const amountOffset = 8 + 32 + 32 + 8;
    const unlockTimeOffset = amountOffset + 8;
    const isClaimedOffset = unlockTimeOffset + 8;

    return {
      amount: data.readBigUInt64LE(amountOffset),
      unlockTime: data.readBigInt64LE(unlockTimeOffset),
      isClaimed: data[isClaimedOffset] === 1,
    };
  }

  private decodeLegacyEscrowAccount(data: Buffer): { amount: bigint; unlockTime: bigint; isClaimed: boolean } | null {
    const minLegacyEscrowAccountLength = 8 + 32 + 32 + 8 + 8 + 1;
    if (data.length < minLegacyEscrowAccountLength) return null;

    const amountOffset = 8 + 32 + 32;
    const unlockTimeOffset = amountOffset + 8;
    const isClaimedOffset = unlockTimeOffset + 8;

    return {
      amount: data.readBigUInt64LE(amountOffset),
      unlockTime: data.readBigInt64LE(unlockTimeOffset),
      isClaimed: data[isClaimedOffset] === 1,
    };
  }
}
