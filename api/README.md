# 🌐 PayLink API

### High-Performance Backend for On-Chain Payroll Orchestration

The PayLink API is a Node.js backend built with **Fastify** and **TypeScript**. it serves as the orchestration layer between the Solana blockchain, the frontend application, and off-ramp providers.

---

## 🛠 Features

- **Transaction Orchestration:** Builds unsigned Solana transactions client-side signing and handles on-chain confirmation.
- **Off-Ramp Integration:** Interfaces with P2P liquidity bridges for USDC to NGN settlement.
- **Payroll Scheduling:** Manages recurring payment jobs using **BullMQ** and **Redis**.
- **Public Profile Resolution:** Resolves user-friendly usernames to on-chain wallets and profile data.
- **Webhooks:** Listens to on-chain events via Helius Webhooks to update transaction status in real-time.

---

## 🏗 Tech Stack

- **Runtime:** Node.js
- **Framework:** Fastify
- **Language:** TypeScript
- **Database:** PostgreSQL (Supabase)
- **Task Queue:** BullMQ + Redis
- **Blockchain SDK:** `@solana/web3.js`, `@coral-xyz/anchor`

---

## 🚀 Getting Started

### Installation

1. Navigate to the api directory:
   ```bash
   cd api
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

Create a `.env` file based on `.env.example`:

```env
DATABASE_URL=your_supabase_postgresql_url
REDIS_HOST=localhost
REDIS_PORT=6379
HELIUS_RPC_URL=your_helius_rpc_endpoint
HELIUS_API_KEY=your_api_key
```

### Development

Run the development server with hot-reloading:
```bash
npm run dev
```

### Build

Compile the TypeScript source to production-ready JavaScript:
```bash
npm run build
```

---

## 📡 API Endpoints (Core)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/auth/wallet` | Authenticate using wallet signature |
| `GET` | `/users/:username` | Resolve public profile data |
| `POST` | `/payments/initiate` | Build unsigned escrow transaction |
| `POST` | `/payroll/schedule` | Create recurring payroll job |
| `GET` | `/offramp/rate` | Get live USDC/NGN exchange rate |
| `POST` | `/webhooks/helius` | On-chain event listener |

---

## 🧪 Testing

Run the test suite:
```bash
npm test
```
