# CCTP service

This directory preserves the direct Circle CCTP implementation for background
treasury rebalancing or a future non-custodial transfer mode.

The live `/cross-chain/verify` checkout flow now uses the hybrid mirror model:

1. User transfers EVM USDC to the configured treasury address.
2. The API verifies the ERC-20 `Transfer` event.
3. The backend pays Solana USDC from the Solana treasury wallet.
4. CCTP can later rebalance treasury liquidity asynchronously.
