'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { verifyCrossChainPayment } from '@/lib/api';
import { CheckCircle2, ExternalLink, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';

type Status = 'idle' | 'connecting' | 'sending_evm' | 'verifying' | 'done' | 'error';
type NetworkId = 'sepolia' | 'avalanche_fuji' | 'sui' | 'hedera';

interface CrossChainPaymentFormProps {
  recipientUsername: string;
  recipientWallet: string;
}

const EVM_CHAINS = {
  sepolia: {
    chainId: '0xaa36a7', // 11155111
    chainName: 'Sepolia',
    rpcUrls: ['https://rpc2.sepolia.org'],
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'SEP', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  },
  avalanche_fuji: {
    chainId: '0xa869', // 43113
    chainName: 'Avalanche Fuji Testnet',
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://testnet.snowtrace.io'],
    usdcAddress: "0x5425890298aed601595a70ab815c96711a31bc65"
  }
};

// A dummy deposit address if env is missing
const EVM_DEPOSIT_ADDRESS = process.env.NEXT_PUBLIC_EVM_DEPOSIT_ADDRESS || "0x000000000000000000000000000000000000dEaD";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

export function CrossChainPaymentForm({
  recipientUsername,
  recipientWallet,
}: CrossChainPaymentFormProps) {
  const [network, setNetwork] = useState<NetworkId>('sepolia');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [solanaTxSig, setSolanaTxSig] = useState('');
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
      return;
    }

    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setErrorMsg("Please install MetaMask or another Web3 wallet.");
      setStatus('error');
      return;
    }
    
    setStatus('connecting');
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      setEvmAccount(accounts[0]);
      
      const chainConfig = EVM_CHAINS[network as keyof typeof EVM_CHAINS];
      
      // Request network switch
      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainConfig.chainId }],
        });
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          await (window as any).ethereum.request({
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
      
      setStatus('idle');
      setErrorMsg('');
    } catch (err: any) {
      console.error(err);
      handleError(err);
    }
  }

  function handleError(err: any) {
    let newErrorMsg = "Transaction failed.";
    if (err?.code === 'ACTION_REJECTED' || err?.message?.includes('user rejected') || err?.code === 4001) {
      newErrorMsg = "User denied transaction signature.";
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
    setStatus('error');
  }

  async function handlePay() {
    if (network === 'sui' || network === 'hedera') {
      setErrorMsg(`${network === 'sui' ? 'Sui' : 'Hedera'} integration is coming soon!`);
      setStatus('error');
      return;
    }

    if (!evmAccount) {
      await connectWallet();
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
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      
      const chainConfig = EVM_CHAINS[network as keyof typeof EVM_CHAINS];
      
      // Ensure we are on the correct network before sending
      const networkData = await provider.getNetwork();
      if (networkData.chainId !== BigInt(chainConfig.chainId)) {
        await connectWallet(); // This forces a network switch
      }

      // Check user balance first
      const usdcContract = new ethers.Contract(chainConfig.usdcAddress, ERC20_ABI, signer);
      const amountInUnits = ethers.parseUnits(parsedAmount.toString(), 6); // USDC has 6 decimals
      
      const balance = await usdcContract.balanceOf(evmAccount);
      if (balance < amountInUnits) {
        throw new Error(`Insufficient USDC balance on ${chainConfig.chainName}. You need at least ${parsedAmount} USDC.`);
      }
      
      const tx = await usdcContract.transfer(EVM_DEPOSIT_ADDRESS, amountInUnits);
      setEvmTxHash(tx.hash);
      
      // Wait for 1 confirmation
      await tx.wait(1);

      setStatus('verifying');

      // Now tell the backend to verify and fulfill on Solana
      const result = await verifyCrossChainPayment({
        source_chain: network,
        tx_hash: tx.hash,
        recipient_wallet: recipientWallet,
        amount_usdc: parsedAmount,
      });

      if (result.success) {
        setSolanaTxSig(result.destTxSignature);
        setStatus('done');
      } else {
        throw new Error("Backend verification failed");
      }

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
            <p className="text-[#8896B3] text-xs mb-3">Funds bridged and sent to recipient on Solana.</p>
            <div className="flex flex-col gap-2">
              <a
                href={getExplorerUrl(evmTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-[#8896B3] text-xs hover:text-[#3B82F6] transition-colors group"
              >
                1. {network === 'sepolia' ? 'Ethereum' : 'Avalanche'} Tx <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
              {solanaTxSig && !solanaTxSig.startsWith('mock_sig') && (
                <a
                  href={`https://solscan.io/tx/${solanaTxSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-[#8896B3] text-xs hover:text-[#00C896] transition-colors group"
                >
                  2. Solana Payout Tx <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </a>
              )}
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
             status === 'verifying' ? <><RefreshCw className="animate-spin" size={18} /> Bridging to Solana...</> :
             network === 'sui' || network === 'hedera' ? 'Coming Soon' :
             !evmAccount ? 'Connect EVM Wallet' :
             `Bridge & Pay ${amount ? `$${amount}` : ''}`}
          </button>
          
          <div className="mt-2 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 p-3 text-xs text-[#3B82F6] text-center flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider">Cross-Chain Magic 🪄</span>
            <span className="text-white/60">Pay with {network === 'sepolia' ? 'Ethereum' : network === 'avalanche_fuji' ? 'Avalanche' : 'other'} USDC. Recipient gets Solana USDC.</span>
          </div>
        </>
      )}
    </div>
  );
}
