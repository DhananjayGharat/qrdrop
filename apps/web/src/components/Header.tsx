import React from 'react';
import { History, ArrowLeft, Sun, Moon } from 'lucide-react';

interface HeaderProps {
  onGoHome?: () => void;
  onOpenHistory?: () => void;
  showBack?: boolean;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onGoHome,
  onOpenHistory,
  showBack = false,
  darkMode,
  setDarkMode,
}) => {
  return (
    <header className="w-full max-w-4xl mx-auto flex items-center justify-between py-4 px-4 sm:px-6">
      <div className="flex items-center space-x-3">
        {showBack && onGoHome && (
          <button
            onClick={onGoHome}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div 
          onClick={onGoHome}
          className="flex items-center space-x-3 cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <svg viewBox="0 0 100 100" className="w-7 h-7 text-white fill-current">
              <path d="M26 26H42V42H26V26Z" fill="white" />
              <path d="M58 26H74V42H58V26Z" fill="white" />
              <path d="M26 58H42V74H26V58Z" fill="white" />
              <path d="M54 54L72 72M72 72H60M72 72V60" stroke="#93C5FD" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              QRDrop
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                v1.0
              </span>
            </h1>
            <p className="text-xs text-slate-400">Scan. Select. Send.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors text-sm font-medium border border-slate-700/60"
          >
            <History className="w-4 h-4 text-blue-400" />
            <span className="hidden sm:inline">History</span>
          </button>
        )}
      </div>
    </header>
  );
};
