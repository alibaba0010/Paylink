# ⚡ PayLink

### On-Chain Payroll Infrastructure for Africa's Digital Workforce

PayLink is a high-performance, on-chain payroll and payment infrastructure protocol built on Solana. It is purpose-built to empower the fast-growing remote and gig workforce across Africa, starting with Nigeria. By leveraging Solana's sub-second finality and near-zero transaction costs, PayLink enables seamless USDC settlement and instant local currency off-ramps.

---

## 📖 Table of Contents

- [Core Vision](#-core-vision)
- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [Project Structure](#-project-structure)
- [Technical Stack](#-technical-stack)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
- [Off-Ramp Infrastructure](#-off-ramp-infrastructure)
- [License](#-license)

---

## 🚀 Core Vision

Nigerian developers and freelancers often lose 10-20% of their hard-earned income to predatory FX conversion fees and unreliable traditional payment rails. **PayLink** solves this by:
- **Zero Hidden Fees:** Utilizing USDC on Solana for settlement reduces overhead to <1%.
- **Instant Finality:** Moving from 3-5 day wire transfers to <1 second settlement.
- **Financial Autonomy:** Providing portable, on-chain payment history independently of centralized platforms.

---

## 🏗 System Architecture

PayLink is designed with a modular, scalable architecture consisting of four primary layers:

1.  **Blockchain Layer (Anchor/Rust):** Secure escrow smart contracts and payroll stream logic on the Solana network.
2.  **API Layer (Node.js/Fastify):** High-performance RESTful services for transaction orchestration, off-ramp integration, and user management.
3.  **Frontend Layer (Next.js 14):** A responsive, premium web interface providing a "pivy.me-inspired" user experience.
4.  **Database Layer (PostgreSQL/Supabase):** Reliable persistence for user profiles, transaction history, and recurring payroll schedules.

---

## ✨ Key Features

### 1. Reusable PayLinks
Every user receives a personalized, shareable URL (`paylink.app/u/username`). Senders can pay in USDC instantly without requiring a complex onboarding flow.

### 2. Smart Escrow & Streams
Funds are held in secure, program-derived addresses (PDAs). Support for:
- **One-time Invoice Links:** Fixed or open amount payments.
- **Payroll Streams:** Scheduled recurring payments (weekly, bi-weekly, monthly).
- **Time-Locked Payments:** Controlled release of funds based on project milestones.

### 3. Native Off-Ramping
Integrated liquidity bridges allowing workers to convert USDC to Nigerian Naira (NGN) and deposit directly to local bank accounts with a single click.

---

## 📂 Project Structure

```text
paylink/
├── anchor/             # Solana smart contracts (Rust/Anchor)
│   ├── programs/       # Core payroll and escrow programs
│   └── tests/          # Functional test suite
├── api/                # Backend services (Node.js/Fastify)
│   ├── src/db/         # Database client and Supabase integration
│   ├── src/routes/     # API endpoint definitions
│   └── src/services/   # Solana transaction builders & business logic
├── frontend/           # Web application (Next.js 14)
│   ├── app/            # App router pages (Shared PayLinks, Dashboard)
│   ├── components/     # Reusable UI components (shadcn/ui)
│   └── providers/      # Context providers (Solana Wallet, React Query)
└── Makefile            # Unified development environment orchestration
```

---

## 🛠 Technical Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Blockchain** | Solana | Network for settlement and smart contracts |
| **Smart Contracts** | Rust / Anchor | Secure on-chain logic |
| **Backend** | Fastify (TypeScript) | Scalable REST API |
| **Frontend** | Next.js 14 (App Router) | Modern, SSR-enabled web application |
| **Styling** | Tailwind CSS / shadcn/ui | Premium, component-driven design |
| **Database** | PostgreSQL (Supabase) | Managed relational data storage |
| **Caching/Jobs** | Redis / BullMQ | Recurring payroll job scheduling |
| **RPC** | Helius | High-performance Solana RPC & Webhooks |

---

## 🛠 Getting Started

### Prerequisites

- Node.js (v18+)
- Rust & Solana CLI (for Anchor development)
- Anchor Framework
- A Supabase account for database storage

### Local Development

The project uses a `Makefile` to simplify local environment setup.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-org/paylink.git
    cd paylink
    ```

2.  **Environment Configuration:**
    Ensure valid `.env` files are present in both `/api` and `/frontend` directories. See `.env.example` in respective folders.

3.  **Run Development Environment:**
    ```bash
    make dev
    ```
    This command will start the API service, wait for a healthy status, and subsequently launch the Next.js frontend.

---

## 🏦 Off-Ramp Infrastructure

PayLink utilizes P2P liquidity bridges and regional provider APIs to facilitate deep NGN liquidity. For Nigerian users, this means instant settlement into local commercial banks at market-competitive rates.

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
