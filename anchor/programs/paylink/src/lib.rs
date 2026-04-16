use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("CsWFkhdvqgVr9oVJXQUogTYTEDNPGmA3gAb1HmsH8AsX");

#[program]
pub mod paylink {
    use super::*;

    /// Create a new payment link PDA
    pub fn create_payment_link(
        ctx: Context<CreatePaymentLink>,
        link_id: String,
        amount: u64,        // 0 = open amount (sender decides)
        is_recurring: bool,
        memo: String,
    ) -> Result<()> {
        let link = &mut ctx.accounts.payment_link;
        link.owner          = ctx.accounts.owner.key();
        link.link_id        = link_id;
        link.amount         = amount;
        link.is_recurring   = is_recurring;
        link.memo           = memo;
        link.is_active      = true;
        link.created_at     = Clock::get()?.unix_timestamp;
        link.total_received = 0;
        Ok(())
    }

    /// Employer deposits USDC into escrow for a worker
    pub fn deposit_escrow(
        ctx: Context<DepositEscrow>,
        worker: Pubkey,
        amount: u64,
        unlock_time: i64,   // 0 = immediately claimable
    ) -> Result<()> {
        require!(amount > 0, PayLinkError::InvalidAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.employer    = ctx.accounts.employer.key();
        escrow.worker      = worker;
        escrow.amount      = amount;
        escrow.unlock_time = unlock_time;
        escrow.is_claimed  = false;
        escrow.created_at  = Clock::get()?.unix_timestamp;

        // Transfer USDC from employer wallet → escrow vault (PDA-owned)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from:      ctx.accounts.employer_usdc.to_account_info(),
                    to:        ctx.accounts.escrow_vault.to_account_info(),
                    authority: ctx.accounts.employer.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(PaymentDeposited {
            employer: escrow.employer,
            worker,
            amount,
            timestamp: escrow.created_at,
        });
        Ok(())
    }

    /// Worker claims their payment from escrow
    pub fn claim_payment(ctx: Context<ClaimPayment>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(!escrow.is_claimed,                        PayLinkError::AlreadyClaimed);
        require!(escrow.worker == ctx.accounts.worker.key(), PayLinkError::Unauthorized);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= escrow.unlock_time || escrow.unlock_time == 0,
            PayLinkError::FundsLocked
        );

        escrow.is_claimed = true;
        escrow.claimed_at = now;

        // PDA signs the transfer out of escrow vault
        let escrow_key = escrow.key();
        let seeds = &[
            b"vault",
            escrow_key.as_ref(),
            &[ctx.bumps.escrow_vault],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from:      ctx.accounts.escrow_vault.to_account_info(),
                    to:        ctx.accounts.worker_usdc.to_account_info(),
                    authority: ctx.accounts.escrow_vault.to_account_info(),
                },
                &[seeds],
            ),
            escrow.amount,
        )?;

        emit!(PaymentClaimed {
            worker:    escrow.worker,
            amount:    escrow.amount,
            timestamp: now,
        });
        Ok(())
    }

    /// Employer cancels unclaimed payroll — USDC refunded
    pub fn cancel_payroll(ctx: Context<CancelPayroll>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(!escrow.is_claimed,                           PayLinkError::AlreadyClaimed);
        require!(escrow.employer == ctx.accounts.employer.key(), PayLinkError::Unauthorized);
        escrow.is_claimed = true; // mark as consumed to prevent double-spend

        let escrow_key = escrow.key();
        let seeds = &[b"vault", escrow_key.as_ref(), &[ctx.bumps.escrow_vault]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from:      ctx.accounts.escrow_vault.to_account_info(),
                    to:        ctx.accounts.employer_usdc.to_account_info(),
                    authority: ctx.accounts.escrow_vault.to_account_info(),
                },
                &[seeds],
            ),
            escrow.amount,
        )?;
        Ok(())
    }
}

// ── Account Structs ────────────────────────────────────────────────────────────

#[account]
pub struct PaymentLink {
    pub owner:          Pubkey,   // 32
    pub link_id:        String,   // 4 + 32
    pub amount:         u64,      // 8  (0 = open)
    pub is_recurring:   bool,     // 1
    pub memo:           String,   // 4 + 128
    pub is_active:      bool,     // 1
    pub created_at:     i64,      // 8
    pub total_received: u64,      // 8
}

#[account]
pub struct EscrowAccount {
    pub employer:    Pubkey,  // 32
    pub worker:      Pubkey,  // 32
    pub amount:      u64,     // 8
    pub unlock_time: i64,     // 8
    pub is_claimed:  bool,    // 1
    pub created_at:  i64,     // 8
    pub claimed_at:  i64,     // 8
}

// ── Contexts ───────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(link_id: String)]
pub struct CreatePaymentLink<'info> {
    #[account(
        init, payer = owner,
        space = 8 + 32 + 4+32 + 8 + 1 + 4+128 + 1 + 8 + 8,
        seeds = [b"paylink", owner.key().as_ref(), link_id.as_bytes()],
        bump
    )]
    pub payment_link: Account<'info, PaymentLink>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositEscrow<'info> {
    #[account(
        init, payer = employer,
        space = 8 + 32 + 32 + 8 + 8 + 1 + 8 + 8,
        seeds = [b"escrow", employer.key().as_ref(), worker_usdc.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub employer: Signer<'info>,
    #[account(mut)]
    pub employer_usdc: Account<'info, TokenAccount>,
    /// CHECK: PDA-owned vault
    #[account(
        init_if_needed, payer = employer,
        seeds = [b"vault", escrow.key().as_ref()], bump,
        token::mint = usdc_mint, token::authority = escrow_vault,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    pub worker_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ClaimPayment<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.employer.as_ref(), worker_usdc.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub worker: Signer<'info>,
    /// CHECK: PDA-owned vault
    #[account(mut, seeds = [b"vault", escrow.key().as_ref()], bump)]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub worker_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelPayroll<'info> {
    #[account(
        mut,
        seeds = [b"escrow", employer.key().as_ref(), escrow.worker.as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub employer: Signer<'info>,
    /// CHECK: PDA-owned vault
    #[account(mut, seeds = [b"vault", escrow.key().as_ref()], bump)]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub employer_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum PayLinkError {
    #[msg("Amount must be greater than zero")]  InvalidAmount,
    #[msg("Payment already claimed")]           AlreadyClaimed,
    #[msg("You are not authorized")]            Unauthorized,
    #[msg("Funds are still time-locked")]       FundsLocked,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct PaymentDeposited {
    pub employer:  Pubkey,
    pub worker:    Pubkey,
    pub amount:    u64,
    pub timestamp: i64,
}

#[event]
pub struct PaymentClaimed {
    pub worker:    Pubkey,
    pub amount:    u64,
    pub timestamp: i64,
}
