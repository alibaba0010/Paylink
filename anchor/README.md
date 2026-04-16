# 🦀 PayLink Anchor Programs

### Secure On-Chain Logic for On-Chain Payroll

This directory contains the Solana smart contracts (programs) that power the PayLink protocol. Built using the **Anchor Framework**, these programs handle fund custody through secure escrow PDAs and manage payroll stream logic.

---

## 🛠 Features

- **Escrow System:** Securely hold USDC in Program Derived Addresses (PDAs) until claimed or canceled.
- **Payment Link PDAs:** State-backed accounts for creating and managing reusable payment links.
- **SPL Token Support:** Native integration with the SPL Token program for USDC transfers.
- **Access Control:** Robust authorization checks to ensure only intended recipients can claim funds.

---

## 🏗 Program Structure

- `programs/paylink/src/lib.rs`: The main entry point for the PayLink program.
- `programs/paylink/src/instructions/`: Individual instruction handlers (deposit, claim, cancel, etc.).
- `programs/paylink/src/state/`: Data structures (Accounts) preserved on the blockchain.
- `programs/paylink/src/errors.rs`: Custom error codes for the PayLink protocol.

---

## 🚀 Getting Started

### Prerequisites

- Solana CLI
- Rust
- Anchor Framework (v0.29.0+)

### Building

1. Navigate to the anchor directory:
   ```bash
   cd anchor
   ```
2. Build the program:
   ```bash
   anchor build
   ```

### Testing

Run the TypeScript test suite against a local validator:
```bash
anchor test
```

### Deployment

To deploy the program to Devnet:
```bash
anchor deploy --provider.cluster devnet
```

---

## 📜 Program Instructions

| Instruction | Actor | Description |
| :--- | :--- | :--- |
| `initialize_payroll` | Employer | Initialized a state account for an employer. |
| `create_payment_link` | Worker | Creates a PDA-backed link for receiving funds. |
| `deposit_escrow` | Employer | Deposits USDC into a worker-specific escrow vault. |
| `claim_payment` | Worker | Transfers funds from escrow to the worker's wallet. |
| `cancel_payroll` | Employer | Refunds unclaimed escrowed funds back to the employer. |

---

## 🛡 Security

The PayLink programs prioritize security through:
1.  **Anchor Checks:** Utilizing Anchor's `#[derive(Accounts)]` for automated account validation.
2.  **PDA Validation:** Ensuring escrow vaults are strictly owned by the program and bound to specific participants.
3.  **Signer Verification:** Enforcing strict signer requirements for all state-mutating instructions.
