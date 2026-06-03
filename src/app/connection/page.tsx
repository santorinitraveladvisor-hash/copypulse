import { ShieldCheck, Key, Lock } from 'lucide-react';
import { connectExchange } from './actions';

export default function Connection() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8 text-slate-800">Exchange Connection</h1>
      
      <div className="bg-blue-50 border border-blue-200 p-6 rounded-xl mb-8 text-blue-800 text-sm">
        <div className="flex gap-3 mb-2 font-bold"><ShieldCheck /> Security First</div>
        <p>Your keys are AES-256 encrypted. Never enable "Withdrawal" permissions on Binance.</p>
      </div>

      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <form action={connectExchange} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
              <Key size={16}/> API Key
            </label>
            <input 
              name="apiKey"
              required
              className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="Paste your Binance API Key"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
              <Lock size={16}/> API Secret
            </label>
            <input 
              name="apiSecret"
              type="password"
              required
              className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="Paste your API Secret"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl transition-all"
          >
            Connect Binance Account
          </button>
        </form>
      </div>
    </div>
  );
}
