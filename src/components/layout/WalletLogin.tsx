'use client'
import { useState, useEffect } from 'react';
import { QrCode, CheckCircle2, Loader2, X } from 'lucide-react';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import QRCode from 'qrcode';

export function WalletLogin() {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => { setIsClient(true); }, []);

  async function connectMobile() {
    setLoading(true);
    setQrDataUrl(null);
    try {
      const provider = await EthereumProvider.init({
        projectId: 'a02059ef8c621fe90e7da162caee7bec',
        showQrModal: false,
        chains: [56],
        methods: ['eth_sendTransaction', 'personal_sign'],
      });

      provider.on('display_uri', async (uri: string) => {
        const dataUrl = await QRCode.toDataURL(uri, {
          width: 280,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        setQrDataUrl(dataUrl);
        setLoading(false);
      });

      provider.connect().then(async () => {
        const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
        setAddress(accounts[0]);
        setQrDataUrl(null);
      }).catch(() => {
        setQrDataUrl(null);
        setLoading(false);
      });
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  if (!isClient) return null;

  return (
    <>
      <button
        onClick={connectMobile}
        disabled={loading}
        className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-xs font-black border transition-all ${
          address ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-800 border-slate-700 text-white'
        }`}
      >
        {loading ? <Loader2 className="animate-spin" size={16} /> : address ? <CheckCircle2 size={16} /> : <QrCode size={16} />}
        <span className="truncate uppercase">
          {address ? `${address.substring(0, 6)}...` : 'Scan Binance App'}
        </span>
      </button>

      {qrDataUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 relative max-w-xs w-full mx-4">
            <button
              onClick={() => setQrDataUrl(null)}
              className="absolute top-3 right-3 text-slate-400 hover:text-slate-700"
            >
              <X size={20} />
            </button>
            <p className="text-slate-800 font-bold text-sm">Scan with Binance App</p>
            <img src={qrDataUrl} alt="WalletConnect QR" className="rounded-xl" width={280} height={280} />
            <p className="text-slate-400 text-xs text-center">Open Binance → Web3 Wallet → Scan</p>
          </div>
        </div>
      )}
    </>
  );
}
