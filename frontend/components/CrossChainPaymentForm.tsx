'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { CheckCircle2, ExternalLink, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';

type Status = 'idle' | 'connecting' | 'sending_evm' | 'done' | 'error';
type NetworkId = 'sepolia' | 'avalanche_fuji' | 'sui' | 'hedera';

interface CrossChainPaymentFormProps {
  recipientUsername: string;
  recipientWallet: string;
}

const EVM_CHAINS = {
  sepolia: {
    chainId: '0xaa36a7', // 11155111
    domain: 0,
    chainName: 'Sepolia',
    rpcUrls: ['https://rpc2.sepolia.org'],
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'SEP', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessengerAddress: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  avalanche_fuji: {
    chainId: '0xa869', // 43113
    domain: 1,
    chainName: 'Avalanche Fuji Testnet',
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://testnet.snowtrace.io'],
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
    tokenMessengerAddress: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  }
};

type EvmNetworkId = keyof typeof EVM_CHAINS;
const SOLANA_DOMAIN = 5;
const SOLANA_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const DESTINATION_CALLER_ANY = ethers.ZeroHash;
const CCTP_STANDARD_TRANSFER_FINALITY_THRESHOLD = 2000;

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const TOKEN_MESSENGER_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)"
];

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function solanaAddressToBytes32(address: PublicKey) {
  return ethers.hexlify(address.toBytes());
}

export function CrossChainPaymentForm({
  recipientUsername,
  recipientWallet,
}: CrossChainPaymentFormProps) {
  const [network, setNetwork] = useState<NetworkId>('sepolia');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [evmTxHash, setEvmTxHash] = useState('');
  const [evmAccount, setEvmAccount] = useState<string | null>(null);

  useEffect(() => {
    checkIfConnected();
  }, [network]);

  async function checkIfConnected() {
    if (network === 'sui' || network === 'hedera') return;
    
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          setEvmAccount(accounts[0]);
        }
      } catch (err) {
        console.error("Eth checking error", err);
      }
    }
  }

  async function connectWallet() {
    if (network === 'sui' || network === 'hedera') {
      setErrorMsg(`${network === 'sui' ? 'Sui' : 'Hedera'} integration is coming soon!`);
      setStatus('error');
      return null;
    }

    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setErrorMsg("Please install MetaMask or another Web3 wallet.");
      setStatus('error');
      return null;
    }
    
    setStatus('connecting');
    try {
      const account = await ensureEvmWalletReady(network);
      
      setStatus('idle');
      setErrorMsg('');
      return account;
    } catch (err: any) {
      console.error(err);
      handleError(err);
      return null;
    }
  }

  async function ensureEvmWalletReady(selectedNetwork: EvmNetworkId) {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      throw new Error("Please install MetaMask or another Web3 wallet.");
    }

    const ethereum = (window as any).ethereum;
    const chainConfig = EVM_CHAINS[selectedNetwork];
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const account = accounts[0];

    const currentChainId = await ethereum.request({ method: 'eth_chainId' });
    if (currentChainId?.toLowerCase() !== chainConfig.chainId.toLowerCase()) {
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainConfig.chainId }],
        });
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainConfig.chainId,
                chainName: chainConfig.chainName,
                rpcUrls: chainConfig.rpcUrls,
                nativeCurrency: chainConfig.nativeCurrency,
                blockExplorerUrls: chainConfig.blockExplorerUrls,
              },
            ],
          });
        } else {
          throw switchError;
        }
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const switchedChainId = await ethereum.request({ method: 'eth_chainId' });
        if (switchedChainId?.toLowerCase() === chainConfig.chainId.toLowerCase()) break;
        await wait(100);
      }
    }

    const activeChainId = await ethereum.request({ method: 'eth_chainId' });
    if (activeChainId?.toLowerCase() !== chainConfig.chainId.toLowerCase()) {
      throw new Error(`Switch your wallet to ${chainConfig.chainName} and try again.`);
    }

    setEvmAccount(account);
    return account;
  }

  function handleError(err: any) {
    let newErrorMsg = "Transaction failed.";
    if (err?.code === 'ACTION_REJECTED' || err?.message?.includes('user rejected') || err?.code === 4001) {
      newErrorMsg = "User denied transaction signature.";
    } else if (err?.response?.data?.message) {
      newErrorMsg = err.response.data.message;
    } else if (err?.info?.error?.message) {
      newErrorMsg = err.info.error.message;
    } else if (err?.message) {
      // Try to parse if it's stringified JSON
      try {
        const parsed = JSON.parse(err.message);
        newErrorMsg = parsed.message || err.message;
      } catch(e) {
        newErrorMsg = err.message.length > 100 ? err.message.slice(0, 100) + '...' : err.message;
      }
    }
    setErrorMsg(newErrorMsg);
    console.error('[cross-chain] payment error', {
      network,
      recipientWallet,
      evmTxHash,
      message: newErrorMsg,
      raw: err,
    });
    setStatus('error');
  }

  async function handlePay() {
    if (network === 'sui' || network === 'hedera') {
      setErrorMsg(`${network === 'sui' ? 'Sui' : 'Hedera'} integration is coming soon!`);
      setStatus('error');
      return;
    }

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg("Enter a valid amount");
      setStatus('error');
      return;
    }

    setStatus('sending_evm');
    setErrorMsg('');

    try {
      const chainConfig = EVM_CHAINS[network as EvmNetworkId];
      const activeAccount = await ensureEvmWalletReady(network as EvmNetworkId);
      console.log('[cross-chain] wallet ready', {
        network,
        account: activeAccount,
        chainId: chainConfig.chainId,
        recipientWallet,
        amount: parsedAmount,
      });

      // Create the ethers provider only after MetaMask has settled on the target chain.
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();

      const networkData = await provider.getNetwork();
      if (networkData.chainId !== BigInt(chainConfig.chainId)) {
        throw new Error(`Switch your wallet to ${chainConfig.chainName} and try again.`);
      }

      // Check user balance first
      const usdcContract = new ethers.Contract(chainConfig.usdcAddress, ERC20_ABI, signer);
      const amountInUnits = ethers.parseUnits(parsedAmount.toString(), 6); // USDC has 6 decimals
      
      const balance = await usdcContract.balanceOf(activeAccount);
      console.log('[cross-chain] source USDC balance checked', {
        network,
        account: activeAccount,
        balanceRaw: balance.toString(),
        amountRaw: amountInUnits.toString(),
        usdc: chainConfig.usdcAddress,
      });
      if (balance < amountInUnits) {
        throw new Error(`Insufficient USDC balance on ${chainConfig.chainName}. You need at least ${parsedAmount} USDC.`);
      }

      const allowance = await usdcContract.allowance(activeAccount, chainConfig.tokenMessengerAddress);
      console.log('[cross-chain] allowance checked', {
        network,
        account: activeAccount,
        allowanceRaw: allowance.toString(),
        requiredRaw: amountInUnits.toString(),
        spender: chainConfig.tokenMessengerAddress,
      });
      if (allowance < amountInUnits) {
        console.log('[cross-chain] requesting USDC spending cap approval', {
          network,
          spender: chainConfig.tokenMessengerAddress,
          amountRaw: amountInUnits.toString(),
        });
        const approveTx = await usdcContract.approve(chainConfig.tokenMessengerAddress, amountInUnits);
        console.log('[cross-chain] approval submitted', { network, txHash: approveTx.hash });
        const approvalReceipt = await approveTx.wait(1);
        console.log('[cross-chain] approval confirmed', {
          network,
          txHash: approveTx.hash,
          status: approvalReceipt?.status,
          blockNumber: approvalReceipt?.blockNumber,
        });
      }

      const recipientAta = getAssociatedTokenAddressSync(
        SOLANA_USDC_MINT,
        new PublicKey(recipientWallet)
      );
      const mintRecipient = solanaAddressToBytes32(recipientAta);
      console.log('[cross-chain] prepared CCTP burn', {
        network,
        sourceDomain: chainConfig.domain,
        destinationDomain: SOLANA_DOMAIN,
        recipientWallet,
        recipientUsdcTokenAccount: recipientAta.toBase58(),
        note: 'CCTP mints to the USDC token account (ATA), not the wallet directly',
        mintRecipientBytes32: mintRecipient,
        amountRaw: amountInUnits.toString(),
      });
      const tokenMessenger = new ethers.Contract(
        chainConfig.tokenMessengerAddress,
        TOKEN_MESSENGER_ABI,
        signer
      );
      // Standard CCTP transfers use finalized attestation and are fee-free.
      // Some testnet TokenMessengerV2 deployments do not support getMinFeeAmount.
      const maxFee = BigInt(0);
      
      const tx = await tokenMessenger.depositForBurn(
        amountInUnits,
        SOLANA_DOMAIN,
        mintRecipient,
        chainConfig.usdcAddress,
        DESTINATION_CALLER_ANY,
        maxFee,
        CCTP_STANDARD_TRANSFER_FINALITY_THRESHOLD
      );
      setEvmTxHash(tx.hash);
      console.log('[cross-chain] depositForBurn submitted', {
        network,
        txHash: tx.hash,
        amountRaw: amountInUnits.toString(),
        recipientAta: recipientAta.toBase58(),
      });
      
      // Wait for 1 confirmation
      const burnReceipt = await tx.wait(1);
      console.log('[cross-chain] depositForBurn confirmed', {
        network,
        txHash: tx.hash,
        status: burnReceipt?.status,
        blockNumber: burnReceipt?.blockNumber,
      });

      // Burn confirmed — Circle CCTP will handle the attestation and Solana mint
      setStatus('done');

    } catch (err: any) {
      console.error(err);
      handleError(err);
    }
  }

  const getExplorerUrl = (hash: string) => {
    if (network === 'sepolia') return `https://sepolia.etherscan.io/tx/${hash}`;
    if (network === 'avalanche_fuji') return `https://testnet.snowtrace.io/tx/${hash}`;
    return '#';
  };

  return (
    <div className="flex flex-col gap-4">
      {status === 'error' && (
        <div className="rounded-xl border border-[#FF5F82]/30 bg-[#FF5F82]/10 p-4 text-center text-[#FF5F82] text-sm break-words">
          <AlertCircle className="inline-block mr-1 mb-0.5" size={16} />
          {errorMsg}
          <button onClick={() => setStatus('idle')} className="block mx-auto mt-2 text-xs underline hover:text-white transition-colors">
            Try again
          </button>
        </div>
      )}



      {status === 'done' ? (
        <div className="mt-2 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95">
          <div className="h-16 w-16 rounded-full bg-[#00C896]/10 flex items-center justify-center text-[#00C896]">
            <CheckCircle2 size={40} />
          </div>
          <div className="text-center">
            <p className="text-white font-black uppercase tracking-widest text-sm mb-1">Cross-Chain Success!</p>
            <p className="text-[#8896B3] text-xs mb-3">
              USDC burned on {network === 'sepolia' ? 'Ethereum' : 'Avalanche'}. Circle CCTP will deliver to recipient on Solana.
            </p>
            <div className="flex flex-col gap-2">
              <a
                href={getExplorerUrl(evmTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-[#8896B3] text-xs hover:text-[#3B82F6] transition-colors group"
              >
                View on {network === 'sepolia' ? 'Etherscan' : 'Snowtrace'} <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-[#8896B3] uppercase tracking-wider font-bold">Select Source Chain</label>
            <div className="relative">
              <select
                value={network}
                onChange={(e) => {
                  setNetwork(e.target.value as NetworkId);
                  setEvmAccount(null);
                  setStatus('idle');
                }}
                disabled={status !== 'idle' && status !== 'error'}
                className="w-full appearance-none bg-[#0A0F1E] border border-[#1A2235] rounded-xl
                           px-4 py-3 text-white focus:border-[#3B82F6] focus:outline-none transition-colors disabled:opacity-50"
              >
                <option value="sepolia">Ethereum (Sepolia Testnet)</option>
                <option value="avalanche_fuji">Avalanche (Fuji Testnet)</option>
                <option value="sui">Sui (Testnet) - Coming Soon</option>
                <option value="hedera">Hedera (Testnet) - Coming Soon</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8896B3] pointer-events-none" size={16} />
            </div>
          </div>

          <div className="relative mt-2">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8896B3] font-bold">$</span>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={status !== 'idle' && status !== 'error'}
              className="w-full bg-[#0A0F1E] border border-[#1A2235] rounded-xl
                         pl-8 pr-16 py-3 text-white text-lg focus:border-[#3B82F6]
                         focus:outline-none transition-colors disabled:opacity-50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8896B3] text-sm">USDC</span>
          </div>

          <button
            onClick={handlePay}
            disabled={(status !== 'idle' && status !== 'error' && status !== 'connecting') || (!evmAccount && status === 'connecting')}
            className={`w-full font-bold py-4 rounded-xl text-base sm:text-lg transition-colors
                       disabled:opacity-60 disabled:cursor-not-allowed flex justify-center items-center gap-2 mt-2
                       ${!evmAccount && network !== 'sui' && network !== 'hedera' ? 'bg-[#1A2235] text-white hover:bg-[#2C3B5E]' : 'bg-[#3B82F6] text-white hover:bg-[#2563EB]'}`}
          >
            {status === 'connecting' ? 'Connecting...' :
             status === 'sending_evm' ? <><RefreshCw className="animate-spin" size={18} /> Sending Transaction...</> :
             network === 'sui' || network === 'hedera' ? 'Coming Soon' :
             !evmAccount ? 'Connect EVM Wallet' :
             `Pay ${amount ? `$${amount}` : ''}`}
          </button>
          
          <div className="mt-2 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 p-3 text-xs text-[#3B82F6] text-center flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider">Cross-Chain Payment 🪄</span>
            <span className="text-white/60">Pay with {network === 'sepolia' ? 'Ethereum' : network === 'avalanche_fuji' ? 'Avalanche' : 'other'} USDC. Recipient gets Solana USDC via Circle CCTP.</span>
          </div>
        </>
      )}
    </div>
  );
}
