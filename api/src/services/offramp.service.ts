import axios from 'axios';

const P2P_API_URL = process.env.P2P_BRIDGE_API_URL!;
const P2P_API_KEY = process.env.P2P_BRIDGE_API_KEY!;

interface RateResponse {
  usdcToNgn: number;
  feePct:    number;
  provider:  string;
}

interface OffRampParams {
  workerWallet:  string;
  amountUSDC:    number;
  bankCode:      string;
  accountNumber: string;
  accountName:   string;
}

interface OffRampResult {
  reference:   string;
  etaMinutes:  number;
  amountNGN:   number;
}

export class OffRampService {

  async getRate(): Promise<RateResponse> {
    if (P2P_API_URL === 'https://example.com' || P2P_API_URL.includes('example')) {
      return { usdcToNgn: 1450, feePct: 1.5, provider: 'MockProvider' };
    }
    const res = await axios.get(`${P2P_API_URL}/rates`, {
      params: { from: 'USDC', to: 'NGN' },
      headers: { Authorization: `Bearer ${P2P_API_KEY}` },
    });
    return {
      usdcToNgn: res.data.rate,
      feePct:    res.data.fee_pct,
      provider:  res.data.provider,
    };
  }

  async initiateOffRamp(params: OffRampParams): Promise<OffRampResult> {
    const { usdcToNgn, feePct } = await this.getRate();

    const feeAmount  = params.amountUSDC * (feePct / 100);
    const netUSDC    = params.amountUSDC - feeAmount;
    const amountNGN  = netUSDC * usdcToNgn;
    const reference  = `PL_${Date.now()}_${params.workerWallet.slice(0, 8)}`;

    if (P2P_API_URL === 'https://example.com' || P2P_API_URL.includes('example')) {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      return { reference, etaMinutes: 15, amountNGN: Math.floor(amountNGN) };
    }

    const res = await axios.post(
      `${P2P_API_URL}/offramp`,
      {
        amount_usdc:    params.amountUSDC,
        bank_code:      params.bankCode,
        account_number: params.accountNumber,
        account_name:   params.accountName,
        reference,
        currency:       'NGN',
      },
      { headers: { Authorization: `Bearer ${P2P_API_KEY}` } }
    );

    return {
      reference:  res.data.reference,
      etaMinutes: res.data.eta_minutes,
      amountNGN:  Math.floor(amountNGN),
    };
  }

  async checkStatus(reference: string) {
    if (P2P_API_URL === 'https://example.com' || P2P_API_URL.includes('example')) {
      return 'completed';
    }
    const res = await axios.get(`${P2P_API_URL}/offramp/${reference}`, {
      headers: { Authorization: `Bearer ${P2P_API_KEY}` },
    });
    return res.data.status; // 'pending' | 'processing' | 'completed' | 'failed'
  }
}
