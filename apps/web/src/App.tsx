import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { ReceiverView } from './components/ReceiverView';
import { SenderView } from './components/SenderView';
import { HistoryModal } from './components/HistoryModal';
import {
  Send,
  Download,
  CheckCircle2,
  HardDrive,
  ShieldCheck,
  Zap,
  Globe2,
  ArrowRight
} from 'lucide-react';
import { TransferHistoryRecord } from '@shared/protocol/types';
import { api } from './services/api';

type AppMode = 'HOME' | 'SEND' | 'RECEIVE';

export const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('HOME');
  const [autoConnectToken, setAutoConnectToken] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [recentTransfers, setRecentTransfers] = useState<TransferHistoryRecord[]>([]);

  // Check URL on load for /connect/<token> or ?token=<token>
  useEffect(() => {
    let token: string | null = null;
    const path = window.location.pathname;
    if (path.includes('/connect/')) {
      const parts = path.split('/connect/');
      if (parts[1]) {
        token = parts[1].split('/')[0].split('?')[0];
      }
    }
    if (!token) {
      const params = new URLSearchParams(window.location.search);
      token = params.get('token') || params.get('connect');
    }

    if (token) {
      setAutoConnectToken(token);
      setMode('SEND');
    }
  }, []);

  useEffect(() => {
    loadRecentTransfers();
  }, [mode]);

  const loadRecentTransfers = async () => {
    try {
      const records = await api.getHistory();
      setRecentTransfers(records.slice(0, 3));
    } catch {
      // offline / first load
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} transition-colors duration-200`}>
      {/* Header */}
      <Header
        onGoHome={() => {
          setAutoConnectToken(null);
          setMode('HOME');
          if (window.location.pathname.includes('/connect/')) {
            window.history.replaceState({}, '', '/');
          }
        }}
        onOpenHistory={() => setIsHistoryOpen(true)}
        showBack={mode !== 'HOME'}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center max-w-4xl w-full mx-auto p-4 sm:p-6">
        {mode === 'HOME' && (
          <div className="space-y-8 my-auto animate-in fade-in duration-300">
            {/* Tagline & Hero */}
            <div className="text-center space-y-2 max-w-xl mx-auto">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                Scan. Select. Send.
              </h2>
              <p className="text-sm sm:text-base text-slate-400">
                Universal high-speed file transfer between Desktop, Mobile, and Web browsers.
                Direct local LAN connection — zero cloud storage, zero configuration.
              </p>
            </div>

            {/* SEND / RECEIVE Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-2xl mx-auto w-full">
              {/* SEND Card */}
              <button
                onClick={() => setMode('SEND')}
                className="group relative flex flex-col items-center justify-center p-8 bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-3xl shadow-xl shadow-blue-500/10 active:scale-[0.98] transition-all duration-200 text-white text-center border border-blue-400/20"
              >
                <div className="w-16 h-16 rounded-2xl bg-white/10 group-hover:bg-white/20 flex items-center justify-center mb-4 transition-colors">
                  <Send className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold tracking-tight mb-1">SEND</h3>
                <p className="text-xs text-blue-100/80">Scan QR on receiver and send files</p>
                <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-white/90 group-hover:translate-x-1 transition-transform">
                  <span>Start Sending</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </button>

              {/* RECEIVE Card */}
              <button
                onClick={() => setMode('RECEIVE')}
                className="group relative flex flex-col items-center justify-center p-8 bg-slate-900 hover:bg-slate-850 hover:border-slate-700 rounded-3xl shadow-xl shadow-slate-950/50 active:scale-[0.98] transition-all duration-200 text-white text-center border border-slate-800"
              >
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 group-hover:bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4 transition-colors">
                  <Download className="w-8 h-8 group-hover:scale-110 transition-transform" />
                </div>
                <h3 className="text-2xl font-bold tracking-tight mb-1">RECEIVE</h3>
                <p className="text-xs text-slate-400">Choose destination and generate QR</p>
                <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-blue-400 group-hover:translate-x-1 transition-transform">
                  <span>Receive Files</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </button>
            </div>

            {/* Feature Highlights Bar */}
            <div className="grid grid-cols-3 gap-2 max-w-xl mx-auto text-center py-2">
              <div className="flex flex-col items-center p-2 rounded-xl">
                <Zap className="w-4 h-4 text-amber-400 mb-1" />
                <span className="text-[11px] font-semibold text-slate-300">Direct LAN Speed</span>
                <span className="text-[10px] text-slate-500">Up to 100+ MB/s</span>
              </div>
              <div className="flex flex-col items-center p-2 rounded-xl">
                <ShieldCheck className="w-4 h-4 text-emerald-400 mb-1" />
                <span className="text-[11px] font-semibold text-slate-300">End-to-End Secure</span>
                <span className="text-[10px] text-slate-500">AES-256-GCM + SHA-256</span>
              </div>
              <div className="flex flex-col items-center p-2 rounded-xl">
                <Globe2 className="w-4 h-4 text-blue-400 mb-1" />
                <span className="text-[11px] font-semibold text-slate-300">All Platforms</span>
                <span className="text-[10px] text-slate-500">PC, Mobile & Web</span>
              </div>
            </div>

            {/* Recent Transfers */}
            <div className="max-w-xl mx-auto w-full pt-4">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Recent Transfers
                </span>
                {recentTransfers.length > 0 && (
                  <button
                    onClick={() => setIsHistoryOpen(true)}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                  >
                    View all
                  </button>
                )}
              </div>

              {recentTransfers.length === 0 ? (
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
                  <HardDrive className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium text-slate-400">No Transfers Yet</p>
                  <p className="text-xs text-slate-500 mt-0.5">Your recent transfers will appear here.</p>
                  <button
                    onClick={() => setMode('SEND')}
                    className="mt-3 px-4 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-xl text-xs font-semibold transition-colors"
                  >
                    SEND FILES
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentTransfers.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 transition-colors flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center space-x-3 truncate pr-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="font-semibold text-white truncate">{item.fileNames[0]}</span>
                        {item.fileCount > 1 && (
                          <span className="text-slate-400 shrink-0">+{item.fileCount - 1} more</span>
                        )}
                      </div>
                      <div className="flex items-center space-x-3 text-slate-400 shrink-0">
                        <span>{formatBytes(item.totalBytes)}</span>
                        <span>•</span>
                        <span>{item.remoteDeviceName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === 'RECEIVE' && <ReceiverView onDone={() => setMode('HOME')} />}
        {mode === 'SEND' && (
          <SenderView
            initialToken={autoConnectToken}
            onDone={() => {
              setAutoConnectToken(null);
              setMode('HOME');
              if (window.location.pathname.includes('/connect/')) {
                window.history.replaceState({}, '', '/');
              }
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-500 border-t border-slate-900">
        QRDrop &copy; {new Date().getFullYear()} — Universal Cross-Platform File Transfer
      </footer>

      {/* History Modal */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
};

export default App;
