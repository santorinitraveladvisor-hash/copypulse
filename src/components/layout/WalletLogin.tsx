'use client'
import { useState, useEffect } from 'react';
import { QrCode, CheckCircle2, Loader2 } from 'lucide-react';
import { EthereumProvider } from '@walletconnect/ethereum-provider';

export function WalletLogin() {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => { setIsClient(true); }, []);

  async function connectMobile() {
    setLoading(true);
    try {
      const provider = await EthereumProvider.init({
        projectId: 'a02059ef8c621fe90e7da162caee7bec',
        showQrModal: true,
        chains: [56], 
        methods: ["eth_sendTransaction", "personal_sign"],
        qrModalOptions: { themeMode: "dark" }
      });
      await provider.connect();
      const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
      setAddress(accounts[0]);
    } catch (err: any) { console.error(err); } 
    finally { setLoading(false); }
  }

  if (!isClient) return null;

  return (
    <button 
      onClick={connectMobile}
      disabled={loading}
      className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-xs font-black border transition-all ${
        address ? "bg-green-50 border-green-200 text-green-700" : "bg-slate-800 border-slate-700 text-white"
      }`}
    >
      {loading ? <Loader2 className="animate-spin" size={16} /> : address ? <CheckCircle2 size={16} /> : <QrCode size={16} />}
      <span className="truncate uppercase">{address ? `${address.substring(0,6)}...` : "Scan Binance App"}</span>
    </button>
  );
}
