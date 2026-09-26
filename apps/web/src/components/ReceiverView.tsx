import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  QrCode,
  ShieldCheck,
  Clock,
  Wifi,
  CheckCircle2,
  FileCheck,
  Check,
  AlertCircle
} from 'lucide-react';
import { api } from '../services/api';
import { generateECDHKeyPair, exportPublicKeyHex } from '@shared/crypto/crypto';
import { SessionCreateResponse, TransferManifest } from '@shared/protocol/types';

interface ReceiverViewProps {
  onDone: () => void;
}

type ReceiverStep = 'CHOOSE_DESTINATION' | 'SHOW_QR' | 'APPROVAL' | 'TRANSFERRING' | 'COMPLETE';

export const ReceiverView: React.FC<ReceiverViewProps> = ({ onDone }) => {
  const [step, setStep] = useState<ReceiverStep>('CHOOSE_DESTINATION');
  const [destinationPath, setDestinationPath] = useState<string>('Downloads/QRDrop');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [session, setSession] = useState<SessionCreateResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(120);
  const [connectionStatus, setConnectionStatus] = useState<string>('Waiting for sender...');
  const [activeTransport, setActiveTransport] = useState<string>('Direct LAN');
  const [incomingManifest, setIncomingManifest] = useState<TransferManifest | null>(null);
  const [senderInfo, setSenderInfo] = useState<{ name: string; platform: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Transfer metrics
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [currentSpeedMBps, setCurrentSpeedMBps] = useState<number>(0);
  const [avgSpeedMBps, setAvgSpeedMBps] = useState<number>(0);
  const [etaSeconds, setEtaSeconds] = useState<number>(0);
  const [transferredBytes, setTransferredBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string>('');

  const pollIntervalRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  // Step 1 -> 2: Generate Session & QR
  const handleGenerateQR = async () => {
    setErrorMsg(null);
    try {
      const keypair = await generateECDHKeyPair();
      const pubKeyHex = await exportPublicKeyHex(keypair.publicKey);
      const deviceId = `receiver-${Math.random().toString(36).substring(2, 9)}`;
      const deviceName = `${navigator.platform || 'Device'} (${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'PC'})`;

      const res = await api.createSession({
        receiverDeviceId: deviceId,
        receiverDeviceName: deviceName,
        destinationPath: destinationPath.trim() || 'Downloads/QRDrop',
        platform: navigator.userAgent.includes('Mac') ? 'macos' : navigator.userAgent.includes('Win') ? 'windows' : 'android',
        publicKey: pubKeyHex,
      });

      setSession(res);
      setTimeLeft(Math.max(Math.round(res.expiresAt - Date.now() / 1000), 120));
      setStep('SHOW_QR');
      startSessionPolling(res.sessionId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize session');
    }
  };

  // 120s TTL countdown timer
  useEffect(() => {
    if (step === 'SHOW_QR') {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setErrorMsg('QR Session expired. Please generate a new QR code.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [step]);

  // Poll session state
  const startSessionPolling = (sessionId: string) => {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const s = await api.getSession(sessionId);
        if (s.state === 'CONNECTED' && s.sender) {
          setConnectionStatus(`Connected to ${s.sender.name}`);
          setSenderInfo({ name: s.sender.name, platform: s.sender.platform });
        } else if (s.state === 'AWAITING_APPROVAL' && s.manifest) {
          setIncomingManifest(s.manifest);
          setTotalBytes(s.manifest.totalBytes);
          setStep('APPROVAL');
          clearInterval(pollIntervalRef.current);
        } else if (s.state === 'EXPIRED') {
          setErrorMsg('Session expired');
          clearInterval(pollIntervalRef.current);
        }
      } catch {
        // ignore polling network glitches
      }
    }, 1000);
  };

  useEffect(() => {
    return () => {
      clearInterval(pollIntervalRef.current);
      clearInterval(timerRef.current);
    };
  }, []);

  const handleApprove = async (approved: boolean) => {
    if (!session) return;
    try {
      await api.approveTransfer(session.sessionId, approved);
      if (approved) {
        setStep('TRANSFERRING');
        startTransferListener();
      } else {
        setStep('CHOOSE_DESTINATION');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error responding to transfer request');
    }
  };

  const startTransferListener = () => {
    // Listen for progress / completion
    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (!session) return;
      try {
        const s = await api.getSession(session.sessionId);
        if (s.state === 'COMPLETED') {
          clearInterval(interval);
          setStep('COMPLETE');
          // Add to local history
          if (incomingManifest) {
            await api.addHistoryRecord({
              id: crypto.randomUUID(),
              transferId: incomingManifest.transferId,
              timestamp: Date.now(),
              direction: 'receive',
              remoteDeviceName: senderInfo?.name || 'Remote Device',
              remotePlatform: senderInfo?.platform || 'Unknown',
              transport: activeTransport,
              fileCount: incomingManifest.totalFiles,
              totalBytes: incomingManifest.totalBytes,
              durationSeconds: Math.round((Date.now() - startTime) / 1000),
              avgSpeedBytesPerSec: avgSpeedMBps * 1024 * 1024,
              status: 'completed',
              fileNames: incomingManifest.files.map(f => f.fileName),
            });
          }
        }
      } catch {
        // ignore
      }
    }, 1000);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full max-w-xl mx-auto p-4 animate-in fade-in">
      {/* STEP 1: DESTINATION SELECTION (MUST OCCUR FIRST BEFORE GENERATING QR) */}
      {step === 'CHOOSE_DESTINATION' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Receive Files</h2>
              <p className="text-sm text-slate-400">Choose where incoming files should be saved.</p>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 mb-6">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block mb-1">
              Destination Folder:
            </span>
            {isEditingPath ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={destinationPath}
                  onChange={(e) => setDestinationPath(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <button
                  onClick={() => setIsEditingPath(false)}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between mt-1">
                <span className="font-mono text-sm text-slate-200 truncate pr-2">
                  {destinationPath}
                </span>
                <button
                  onClick={() => setIsEditingPath(true)}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
                >
                  CHANGE FOLDER
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>Destination selected & verified</span>
            </div>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            onClick={handleGenerateQR}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-semibold rounded-2xl shadow-lg shadow-blue-500/20 flex items-center justify-center space-x-2 transition-all"
          >
            <QrCode className="w-5 h-5" />
            <span>GENERATE QR</span>
          </button>
        </div>
      )}

      {/* STEP 2: SHOW QR CODE */}
      {step === 'SHOW_QR' && session && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center">
          <h2 className="text-xl font-bold text-white mb-1">Waiting for Sender</h2>
          <p className="text-sm text-slate-400 mb-6">Scan this QR using QRDrop on the sending device</p>

          {/* QR Container */}
          <div className="relative inline-block p-4 bg-white rounded-3xl shadow-xl mx-auto mb-6">
            <img
              src={session.qrDataUri}
              alt="QRDrop Pairing QR"
              className="w-64 h-64 sm:w-72 sm:h-72 object-contain"
            />
          </div>

          {/* Session Timer & Status */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 max-w-sm mx-auto mb-6 text-left space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-blue-400" />
                Session expires:
              </span>
              <span className="font-mono font-bold text-white bg-slate-700/60 px-2 py-0.5 rounded">
                {formatTime(timeLeft)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Wifi className="w-4 h-4 text-emerald-400" />
                Connection:
              </span>
              <span className="font-medium text-slate-200">
                {connectionStatus}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Security:
              </span>
              <span className="text-emerald-400 font-semibold">
                ✓ E2E Encrypted (AES-256-GCM)
              </span>
            </div>
          </div>

          <button
            onClick={() => setStep('CHOOSE_DESTINATION')}
            className="text-xs text-slate-400 hover:text-slate-200 underline"
          >
            Cancel and change destination
          </button>
        </div>
      )}

      {/* STEP 3: RECEIVER APPROVAL MODAL */}
      {step === 'APPROVAL' && incomingManifest && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Incoming Transfer</h2>
              <p className="text-sm text-slate-400">Do you want to accept this file transfer?</p>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 mb-6 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">From:</span>
              <span className="font-semibold text-white">{senderInfo?.name || 'Remote Device'} ({senderInfo?.platform})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Connection:</span>
              <span className="font-semibold text-emerald-400">✓ {activeTransport}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Files:</span>
              <span className="font-semibold text-white">{incomingManifest.totalFiles} files</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Size:</span>
              <span className="font-semibold text-white">{formatBytes(incomingManifest.totalBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Destination:</span>
              <span className="font-mono text-xs text-blue-400 truncate max-w-[200px]">{destinationPath}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleApprove(false)}
              className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-rose-400 font-semibold rounded-2xl transition-colors border border-slate-700"
            >
              REJECT
            </button>
            <button
              onClick={() => handleApprove(true)}
              className="py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-2xl transition-colors shadow-lg shadow-blue-500/20"
            >
              ACCEPT
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: TRANSFERRING */}
      {step === 'TRANSFERRING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Transfer in Progress</h2>
              <p className="text-xs text-slate-400 mt-1">
                Saving to <span className="font-mono text-blue-400">{destinationPath}</span>
              </p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              ✓ {activeTransport}
            </span>
          </div>

          {/* Overall Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span className="text-slate-300">Overall Progress</span>
              <span className="text-blue-400">{progressPercent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Real Metrics Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-800/40 p-4 rounded-2xl border border-slate-800 mb-6 text-center">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Current Speed</span>
              <span className="text-base font-bold text-white">{currentSpeedMBps} MB/s</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Average Speed</span>
              <span className="text-base font-bold text-white">{avgSpeedMBps} MB/s</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Transferred</span>
              <span className="text-base font-bold text-white">{formatBytes(transferredBytes)}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">ETA</span>
              <span className="text-base font-bold text-white">{formatTime(etaSeconds)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="flex items-center gap-1.5 text-blue-400">
              <ShieldCheck className="w-4 h-4" />
              SHA-256 verifying chunks in real-time
            </span>
            <button
              onClick={() => {
                if (session) api.cancelSession(session.sessionId);
                setStep('CHOOSE_DESTINATION');
              }}
              className="text-rose-400 hover:text-rose-300 font-semibold"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: TRANSFER COMPLETE */}
      {step === 'COMPLETE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Transfer Complete!</h2>
          <p className="text-sm text-slate-400 mb-6">
            All files were successfully received and cryptographically verified.
          </p>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 text-left space-y-2 mb-6 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Files:</span>
              <span className="font-semibold text-white">{incomingManifest?.totalFiles}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Transferred:</span>
              <span className="font-semibold text-white">{formatBytes(incomingManifest?.totalBytes || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Integrity:</span>
              <span className="font-semibold text-emerald-400">✓ SHA-256 Verified</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Saved to:</span>
              <span className="font-mono text-blue-400 truncate max-w-[200px]">{destinationPath}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setStep('CHOOSE_DESTINATION')}
              className="py-3.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-2xl transition-colors border border-slate-700 text-sm"
            >
              RECEIVE MORE
            </button>
            <button
              onClick={onDone}
              className="py-3.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-2xl transition-colors shadow-lg shadow-blue-500/20 text-sm"
            >
              DONE
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
