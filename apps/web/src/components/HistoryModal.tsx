import React, { useState, useEffect } from 'react';
import { X, Search, Trash2, ArrowUpRight, ArrowDownLeft, CheckCircle2, HardDrive } from 'lucide-react';
import { TransferHistoryRecord } from '@shared/protocol/types';
import { api } from '../services/api';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose }) => {
  const [history, setHistory] = useState<TransferHistoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const records = await api.getHistory();
      setHistory(records);
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (confirm('Are you sure you want to clear transfer history?')) {
      await api.clearHistory();
      setHistory([]);
    }
  };

  if (!isOpen) return null;

  const filtered = history.filter(item =>
    item.remoteDeviceName.toLowerCase().includes(search.toLowerCase()) ||
    item.fileNames.some(f => f.toLowerCase().includes(search.toLowerCase()))
  );

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-bold text-white">Transfer History</h2>
            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">
              {history.length}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {history.length > 0 && (
              <button
                onClick={handleClear}
                className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        {history.length > 0 && (
          <div className="p-4 border-b border-slate-800/60 bg-slate-900/50">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by file or device..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-800/90 border border-slate-700/60 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Loading history...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <HardDrive className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
              <p className="text-slate-400 font-medium text-sm">No Transfers Yet</p>
              <p className="text-xs text-slate-500 mt-1">Your recent transfers will appear here.</p>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-slate-800/50 border border-slate-800 hover:border-slate-700 transition-colors flex items-start justify-between gap-4"
              >
                <div className="flex items-start space-x-3">
                  <div className={`p-2 rounded-xl mt-0.5 ${item.direction === 'send' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    {item.direction === 'send' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white text-sm">
                        {item.fileNames[0]}
                        {item.fileCount > 1 && (
                          <span className="text-xs text-slate-400 ml-1">+{item.fileCount - 1} more</span>
                        )}
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">
                        {item.transport.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{item.remoteDeviceName} ({item.remotePlatform})</span>
                      <span>•</span>
                      <span>{formatBytes(item.totalBytes)}</span>
                      <span>•</span>
                      <span>Avg: {formatSpeed(item.avgSpeedBytesPerSec)}</span>
                      <span>•</span>
                      <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Verified</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
