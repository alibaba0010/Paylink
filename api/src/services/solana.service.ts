import {
  Connection, PublicKey, Transaction, SystemProgram
} from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createTransferInstruction, createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import idl from '../idl/paylink.json';
type PayLink = any;

export class SolanaService {
  private connection: Connection;
  private program: any;

  // USDC mint on Solana Devnet (Provided by User)
  private USDC_MINT = new PublicKey(
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  );

  constructor() {
    this.connection = new Connection(
      process.env.HELIUS_RPC_URL!,
      'confirmed'
    );
    // Read-only provider for building (employer signs client-side)
    const provider = new AnchorProvider(this.connection, {} as any, {});
    this.program = new Program(idl as PayLink, provider);
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
    // USDC has 6 decimal places
    const amount   = new BN(Math.round(amountUSDC * 1_000_000));

    const workerUsdcATA = await getAssociatedTokenAddress(
      this.USDC_MINT, worker
    );

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('escrow'),
        employer.toBuffer(),
        workerUsdcATA.toBuffer(),
      ],
      this.program.programId
    );

    const employerUSDC = await getAssociatedTokenAddress(
      this.USDC_MINT, employer
    );

    const [escrowVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), escrowPDA.toBuffer()],
      this.program.programId
    );

    const tx = await this.program.methods
      .depositEscrow(worker, amount, new BN(unlockTime))
      .accounts({
        escrow:        escrowPDA,
        employer,
        employerUsdc:  employerUSDC,
        escrowVault,
        workerUsdc:    workerUsdcATA,
        usdcMint:      this.USDC_MINT,
        tokenProgram:  TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer        = employer;

    // Serialize without requiring all signatures (employer signs in browser)
    return Buffer.from(
      tx.serialize({ requireAllSignatures: false })
    ).toString('base64');
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
   * Submit a signed transaction from the browser and confirm it.
   */
  async confirmTransaction(signedTxBase64: string): Promise<string> {
    const tx = Transaction.from(Buffer.from(signedTxBase64, 'base64'));
    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(sig, 'confirmed');
    return sig;
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
}
