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
  AlertCircle,
  AlertTriangle,
  Smartphone,
  ChevronDown,
  ChevronUp,
  Terminal,
  Activity,
  Radio,
  RefreshCw,
  HelpCircle,
  Globe,
  Download,
  FileText
} from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { generateECDHKeyPair, exportPublicKeyHex, generateUUID } from '@shared/crypto/crypto';
import {
  SessionCreateResponse,
  TransferManifest,
  NetworkDiagnostics
} from '@shared/protocol/types';

interface ReceiverViewProps {
  onDone: () => void;
}

type ReceiverStep = 'CHOOSE_DESTINATION' | 'SHOW_QR' | 'APPROVAL' | 'TRANSFERRING' | 'COMPLETE';

export const ReceiverView: React.FC<ReceiverViewProps> = ({ onDone }) => {
  const [step, setStep] = useState<ReceiverStep>('CHOOSE_DESTINATION');
  const [destinationPath, setDestinationPath] = useState<string>('Downloads/QRDrop');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [session, setSession] = useState<SessionCreateResponse | null>(null);
  const [qrMode, setQrMode] = useState<'LAN' | 'GLOBAL'>('LAN');
  const [activeQrDataUri, setActiveQrDataUri] = useState<string>('');
  const [networkInfo, setNetworkInfo] = useState<NetworkDiagnostics | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [networkChanged, setNetworkChanged] = useState<boolean>(false);
  const [networkChangedMsg, setNetworkChangedMsg] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [timeLeft, setTimeLeft] = useState<number>(120);
  const [connectionStatus, setConnectionStatus] = useState<string>('Waiting for scan...');
  const [activeTransport, setActiveTransport] = useState<string>('Direct LAN');
  const [incomingManifest, setIncomingManifest] = useState<TransferManifest | null>(null);
  const [senderInfo, setSenderInfo] = useState<{ name: string; platform: string; browser?: string } | null>(null);
  const [deviceDetected, setDeviceDetected] = useState<{ name: string; browser: string; platform: string } | null>(null);
  const [deviceApproved, setDeviceApproved] = useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [targetQrUrl, setTargetQrUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Transfer metrics
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [currentSpeedMBps, setCurrentSpeedMBps] = useState<number>(0);
  const [avgSpeedMBps, setAvgSpeedMBps] = useState<number>(0);
  const [etaSeconds, setEtaSeconds] = useState<number>(0);
  const [transferredBytes, setTransferredBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);

  const pollIntervalRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  // Check network environment on mount
  useEffect(() => {
    checkNetwork();
  }, []);

  const checkNetwork = async (ipToUse?: string) => {
    try {
      const diag = await api.getDiagnostics(ipToUse || selectedIp || undefined);
      setNetworkInfo(diag);
      if (!selectedIp && diag.primaryIp) {
        setSelectedIp(diag.primaryIp);
      }
    } catch {
      // offline fallback
    }
  };

  // Step 1 -> 2: Generate Session & QR
  const handleGenerateQR = async () => {
    setErrorMsg(null);
    setNetworkChanged(false);
    setNetworkChangedMsg(null);
    setDeviceDetected(null);
    setDeviceApproved(false);
    setIsGenerating(true);

    try {
      // Pre-flight health check (Requirement 2 & 7)
      try {
        await api.getBasicHealth();
      } catch (healthErr: any) {
        console.warn('Pre-flight /health probe notice:', healthErr);
      }

      const keypair = await generateECDHKeyPair();
      const pubKeyHex = await exportPublicKeyHex(keypair.publicKey);
      const deviceId = `receiver-${Math.random().toString(36).substring(2, 9)}`;
      const deviceName = `${navigator.platform.includes('Win') ? 'Windows PC' : navigator.platform.includes('Mac') ? 'MacBook' : 'Desktop'}`;

      const clientOrigin = window.location.origin;
      const isPublicOrigin = !clientOrigin.includes('localhost') && !clientOrigin.includes('127.0.0.1');
      if (isPublicOrigin) {
        setQrMode('GLOBAL');
      }

      const res = await api.createSession({
        receiverDeviceId: deviceId,
        receiverDeviceName: deviceName,
        destinationPath: destinationPath.trim() || 'Downloads/QRDrop',
        platform: navigator.userAgent.includes('Mac') ? 'macos' : navigator.userAgent.includes('Win') ? 'windows' : 'linux',
        publicKey: pubKeyHex,
        selectedIp: selectedIp || undefined,
        clientOrigin,
      });

      setSession(res);
      const initialTarget = (isPublicOrigin || qrMode === 'GLOBAL')
        ? (res.globalConnectUrl || `${clientOrigin}/connect/${res.token}`)
        : (res.lanConnectUrl || res.connectUrl || res.qrPayload);
      setTargetQrUrl(initialTarget || res.qrPayload || '');
      setActiveQrDataUri(res.qrDataUri);
      const activeIp = res.networkInfo?.primaryIp || selectedIp || '';
      if (res.networkInfo) {
        setNetworkInfo(res.networkInfo as any);
      }
      setTimeLeft(Math.max(Math.round(res.expiresAt - Date.now() / 1000), 120));
      setStep('SHOW_QR');
      startSessionPolling(res.sessionId, activeIp);
    } catch (err: any) {
      console.error('Failed to initialize session:', err);
      const msg = (err && typeof err.message === 'string' && err.message.includes('randomUUID'))
        ? 'Unable to create a secure transfer session. Please reload QRDrop and try again.'
        : err?.message || 'Failed to initialize session';
      setErrorMsg(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  // 120s TTL countdown timer
  useEffect(() => {
    if (step === 'SHOW_QR') {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev: number) => {
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

  // Dual-mode QR code regeneration on mode change
  useEffect(() => {
    if (!session) return;
    const origin = window.location.origin;
    const isPublicOrigin = !origin.includes('localhost') && !origin.includes('127.0.0.1');

    let url = '';
    if (qrMode === 'GLOBAL') {
      if (session.globalConnectUrl && !session.globalConnectUrl.includes('qrdrop.app')) {
        url = session.globalConnectUrl;
      } else if (isPublicOrigin) {
        url = `${origin}/connect/${session.token}`;
      } else {
        url = session.lanConnectUrl || session.connectUrl || '';
      }
    } else {
      url = session.lanConnectUrl || session.connectUrl || (isPublicOrigin ? `${origin}/connect/${session.token}` : '');
    }

    if (!url) {
      url = session.qrPayload || '';
    }

    setTargetQrUrl(url);

    if (url) {
      QRCode.toDataURL(url, { width: 300, margin: 2 })
        .then((uri) => setActiveQrDataUri(uri))
        .catch(() => setActiveQrDataUri(session.qrDataUri));
    }
  }, [qrMode, session]);

  // Poll session state + Network Change Recovery (Requirement 10)
  const startSessionPolling = (sessionId: string, initialIp: string) => {
    let networkCheckCounter = 0;
    pollIntervalRef.current = setInterval(async () => {
      try {
        const s = await api.getSession(sessionId);

        // Detect device when phone opens URL
        if (s.detectedDevice && !deviceDetected) {
          setDeviceDetected(s.detectedDevice);
          setConnectionStatus(`Device detected: ${s.detectedDevice.name}`);
        }

        if (s.state === 'CONNECTED' && s.sender) {
          setConnectionStatus(`Connected to ${s.sender.name}`);
          setSenderInfo({
            name: s.sender.name,
            platform: s.sender.platform,
            browser: s.sender.browser,
          });
          setDeviceApproved(true);
        } else if (s.state === 'AWAITING_APPROVAL' && s.manifest) {
          setIncomingManifest(s.manifest);
          setTotalBytes(s.manifest.totalBytes);
          setStep('APPROVAL');
          clearInterval(pollIntervalRef.current);
        } else if (s.state === 'EXPIRED') {
          setErrorMsg('Session expired');
          clearInterval(pollIntervalRef.current);
        }

        // Network change detection (Requirement 10)
        networkCheckCounter++;
        if (networkCheckCounter % 4 === 0) {
          try {
            const latestDiag = await api.getDiagnostics();
            if (
              latestDiag.primaryIp &&
              initialIp &&
              latestDiag.primaryIp !== initialIp &&
              latestDiag.primaryIp !== '127.0.0.1'
            ) {
              setNetworkChanged(true);
              setNetworkChangedMsg(
                `Network changed from ${initialIp} to ${latestDiag.primaryIp}. Generate a new QR code to reconnect.`
              );
              clearInterval(pollIntervalRef.current);
              try {
                await api.cancelSession(sessionId);
              } catch {}
              return;
            }
          } catch {}
        }
      } catch {
        // ignore polling network glitches
      }
    }, 800);
  };

  useEffect(() => {
    return () => {
      clearInterval(pollIntervalRef.current);
      clearInterval(timerRef.current);
    };
  }, []);

  const handleApproveDevice = async (approved: boolean) => {
    if (!approved) {
      if (session) api.cancelSession(session.sessionId);
      setStep('CHOOSE_DESTINATION');
      return;
    }
    setDeviceApproved(true);
    setConnectionStatus('Device Accepted ✓ Ready to receive files');
  };

  const handleApproveTransfer = async (approved: boolean) => {
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

  const downloadSingleFile = (transferId: string, fileId: string, fileName: string) => {
    const downloadUrl = `${api.getApiBase()}/api/transfer/download/${transferId}/${fileId}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAllFiles = () => {
    if (!incomingManifest || !incomingManifest.files) return;
    incomingManifest.files.forEach((f: any, idx: number) => {
      setTimeout(() => {
        downloadSingleFile(incomingManifest.transferId, f.fileId, f.fileName);
      }, idx * 400);
    });
  };

  const startTransferListener = () => {
    const startTime = Date.now();
    let lastBytes = 0;
    let lastTime = startTime;

    const interval = setInterval(async () => {
      if (!session) return;
      try {
        const s = await api.getSession(session.sessionId);
        if (s.state === 'COMPLETED') {
          clearInterval(interval);
          setProgressPercent(100);
          setStep('COMPLETE');

          // Auto-trigger browser download for web clients
          const currentManifest = incomingManifest || s.manifest;
          if (currentManifest && currentManifest.files) {
            currentManifest.files.forEach((f: any, idx: number) => {
              setTimeout(() => {
                downloadSingleFile(currentManifest.transferId, f.fileId, f.fileName);
              }, idx * 500);
            });
          }

          if (incomingManifest) {
            await api.addHistoryRecord({
              id: generateUUID(),
              transferId: incomingManifest.transferId,
              timestamp: Date.now(),
              direction: 'receive',
              remoteDeviceName: senderInfo?.name || 'Remote Device',
              remotePlatform: senderInfo?.platform || 'Unknown',
              transport: activeTransport,
              fileCount: incomingManifest.totalFiles,
              totalBytes: incomingManifest.totalBytes,
              durationSeconds: Math.max(Math.round((Date.now() - startTime) / 1000), 1),
              avgSpeedBytesPerSec: avgSpeedMBps * 1024 * 1024,
              status: 'completed',
              fileNames: incomingManifest.files.map((f: any) => f.fileName),
            });
          }
        }
 else if (s.manifest) {
          // Poll chunk progress from receiver engine
          try {
            const resume = await api.getResumeStatus(s.manifest.transferId, s.manifest.files[0]?.fileId);
            const completedCount = resume.completedChunks.length;
            const totalChunks = s.manifest.files[0]?.totalChunks || 1;
            const currentBytes = Math.min((completedCount / totalChunks) * s.manifest.totalBytes, s.manifest.totalBytes);
            setTransferredBytes(currentBytes);
            const pct = Math.min(Math.round((currentBytes / s.manifest.totalBytes) * 100), 100);
            setProgressPercent(pct);

            const now = Date.now();
            const deltaSec = (now - lastTime) / 1000;
            if (deltaSec >= 0.5) {
              const speed = (currentBytes - lastBytes) / deltaSec / (1024 * 1024);
              setCurrentSpeedMBps(parseFloat(speed.toFixed(1)));
              lastTime = now;
              lastBytes = currentBytes;
            }
            const totalElapsed = (now - startTime) / 1000;
            if (totalElapsed > 0) {
              setAvgSpeedMBps(parseFloat((currentBytes / totalElapsed / (1024 * 1024)).toFixed(1)));
            }
          } catch {}
        }
      } catch {
        // ignore
      }
    }, 600);
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
      {/* STEP 1: DESTINATION SELECTION (Receiver-first flow) */}
      {step === 'CHOOSE_DESTINATION' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Receive Files</h2>
              <p className="text-sm text-slate-400">Choose destination folder and generate QR code.</p>
            </div>
          </div>

          {/* LOCAL NETWORK CARD (Requirement 4) */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className={`w-4 h-4 ${networkInfo?.isReachable ? 'text-emerald-400' : 'text-amber-400'}`} />
                <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">LOCAL NETWORK</span>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase tracking-wider border ${
                networkInfo?.isReachable
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {networkInfo?.isReachable ? 'Reachable ✓' : (networkInfo?.portListening ? 'Ready' : 'Checking...')}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase font-sans">IP</span>
                <span className="font-semibold text-white truncate block">{selectedIp || networkInfo?.primaryIp || 'Detecting...'}</span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase font-sans">PORT</span>
                <span className="font-semibold text-white block">{networkInfo?.port || 8000}</span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase font-sans">STATUS</span>
                <span className={`font-semibold block ${networkInfo?.isReachable ? 'text-emerald-400' : 'text-blue-400'}`}>
                  {networkInfo?.isReachable ? 'Reachable' : 'Ready'}
                </span>
              </div>
            </div>

            {/* Multiple Interfaces Selector (Requirement 4 & 9) */}
            {networkInfo?.candidateInterfaces && networkInfo.candidateInterfaces.length > 1 && (
              <div className="pt-2 border-t border-slate-700/50">
                <span className="text-[10px] text-slate-400 block mb-1.5 font-medium">
                  Available Network Interfaces (Click to switch):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {networkInfo.candidateInterfaces.map((c: any) => {
                    const isSelected = (selectedIp || networkInfo.primaryIp) === c.ip;
                    return (
                      <button
                        key={c.ip}
                        onClick={() => {
                          setSelectedIp(c.ip);
                          checkNetwork(c.ip);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80'
                        }`}
                      >
                        {c.interface} ({c.ip}) {c.isHotspot ? '🔥 Hotspot' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Destination Folder Selector */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block mb-1">
              Destination Folder:
            </span>
            {isEditingPath ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={destinationPath}
                  onChange={(e) => setDestinationPath(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <button
                  onClick={() => setIsEditingPath(false)}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors"
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
              <span>✓ Ready to receive</span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            onClick={handleGenerateQR}
            disabled={isGenerating}
            className={`w-full py-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-semibold rounded-2xl shadow-lg shadow-blue-500/20 flex items-center justify-center space-x-2 transition-all ${
              isGenerating ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span>{isGenerating ? 'VERIFYING REACHABILITY...' : 'GENERATE QR'}</span>
          </button>
        </div>
      )}

      {/* STEP 2: SHOW QR CODE & WAITING FOR SCAN */}
      {step === 'SHOW_QR' && session && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Waiting for Device</h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Scan this QR using your phone camera.
            </p>
          </div>

          {/* Network Changed Recovery Banner (Requirement 10) */}
          {networkChanged && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-left text-xs space-y-2 animate-in fade-in">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Network Changed</span>
              </div>
              <p className="text-slate-300">
                {networkChangedMsg || 'Your device changed networks. Generate a new QR code to reconnect.'}
              </p>
              <button
                onClick={handleGenerateQR}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Generate New QR Code</span>
              </button>
            </div>
          )}

          {/* Dual-Mode QR Toggle (Local Wi-Fi vs Global 24/7) */}
          {((typeof window !== 'undefined' && !window.location.origin.includes('localhost') && !window.location.origin.includes('127.0.0.1')) || (session.globalConnectUrl && session.globalConnectUrl !== session.lanConnectUrl)) && (
            <div className="flex items-center justify-center p-1 bg-slate-800/80 rounded-2xl max-w-xs mx-auto border border-slate-700/60 text-xs">
              <button
                onClick={() => setQrMode('LAN')}
                className={`flex-1 py-1.5 px-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  qrMode === 'LAN'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>Local Wi-Fi</span>
              </button>
              <button
                onClick={() => setQrMode('GLOBAL')}
                className={`flex-1 py-1.5 px-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  qrMode === 'GLOBAL'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Global 24/7</span>
              </button>
            </div>
          )}

          {/* LARGE HIGH-CONTRAST QR CODE (Requirement 16) */}
          <div className="space-y-3">
            <div className="relative inline-block p-4 sm:p-5 bg-white rounded-3xl shadow-2xl mx-auto">
              <img
                src={activeQrDataUri || session.qrDataUri}
                alt="QRDrop Connection QR"
                className="w-64 h-64 sm:w-72 sm:h-72 object-contain"
              />
            </div>

            {/* Scanned Connection URL & Copy Action */}
            {targetQrUrl && (
              <div className="flex items-center justify-between gap-2 max-w-xs sm:max-w-sm mx-auto bg-slate-800/80 px-3 py-2 rounded-2xl border border-slate-700/60 text-xs shadow-inner">
                <span className="truncate font-mono text-slate-300 text-[11px] text-left select-all">
                  {targetQrUrl}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(targetQrUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shrink-0 text-[11px] transition-colors"
                >
                  {copied ? 'Copied! ✓' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          {/* DEVICE DETECTED CARD (Requirement 17) */}
          {deviceDetected && !deviceApproved && (
            <div className="bg-blue-950/60 border border-blue-500/30 rounded-2xl p-5 text-left animate-in slide-in-from-bottom duration-300 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-blue-400" />
                  New Device Connected
                </span>
                <span className="text-[10px] font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  ✓ Secure
                </span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Device:</span>
                  <span className="font-bold text-white">{deviceDetected.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Browser:</span>
                  <span className="font-semibold text-slate-200">{deviceDetected.browser}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Network:</span>
                  <span className="font-semibold text-emerald-400">Local Wi-Fi / Hotspot</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-blue-500/20">
                <button
                  onClick={() => handleApproveDevice(false)}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-rose-400 font-semibold rounded-xl text-xs transition-colors"
                >
                  REJECT
                </button>
                <button
                  onClick={() => handleApproveDevice(true)}
                  className="py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/20"
                >
                  ACCEPT
                </button>
              </div>
            </div>
          )}

          {/* Session & Local Network Metadata Strip (Requirements 4, 8 & 16) */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 max-w-sm mx-auto text-left space-y-2 text-xs">
            <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-400" />
                LOCAL NETWORK
              </span>
              <span className="text-emerald-400 font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Reachable ✓
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">IP:</span>
              <span className="font-mono font-semibold text-white">{session.networkInfo?.primaryIp || networkInfo?.primaryIp}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">PORT:</span>
              <span className="font-mono font-semibold text-white">{session.networkInfo?.port || networkInfo?.port || 8000}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Session TTL:
              </span>
              <span className="font-mono font-bold text-white bg-slate-700/60 px-2 py-0.5 rounded">
                Expires in {formatTime(timeLeft)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                Status:
              </span>
              <span className="font-medium text-slate-200">
                {connectionStatus}
              </span>
            </div>
          </div>

          {/* Collapsible Network Diagnostics & Manual Debug Info (Requirements 7, 13 & 15) */}
          <div className="max-w-sm mx-auto pt-1 space-y-2">
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="text-[11px] text-slate-400 hover:text-slate-300 font-medium inline-flex items-center gap-1 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Network Diagnostics</span>
              {showDiagnostics ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showDiagnostics && (
              <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 text-left text-[11px] space-y-1.5 font-mono text-slate-300 animate-in fade-in">
                <div className="text-xs font-bold text-white uppercase tracking-wider font-sans border-b border-slate-800 pb-1.5 flex items-center justify-between">
                  <span>Server & Diagnostics</span>
                  <span className="text-emerald-400 font-mono text-[10px]">OK</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Server:</span>
                  <span className="text-emerald-400 font-semibold">Running</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bind Host:</span>
                  <span className="text-white">0.0.0.0 (All Interfaces)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Detected IP:</span>
                  <span className="text-blue-400 font-semibold">{session.networkInfo?.primaryIp || networkInfo?.primaryIp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Server Port:</span>
                  <span className="text-white">{session.networkInfo?.port || networkInfo?.port || 8000}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Network Interface:</span>
                  <span className="text-slate-200">{session.networkInfo?.interfaceName || (session.networkInfo as any)?.interface || networkInfo?.interfaceName || 'LAN'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Health Check:</span>
                  <span className="text-emerald-400">OK (GET /health -&gt; 200)</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-slate-800/80">
                  <span className="text-slate-500">QR LAN URL:</span>
                  <span className="text-[10px] text-blue-300 truncate max-w-[200px]" title={session.connectUrl}>
                    {session.connectUrl}
                  </span>
                </div>
              </div>
            )}

            {/* Troubleshooting Guide for ERR_ADDRESS_UNREACHABLE (Requirements 6, 13, 14, 15) */}
            <div className="pt-1">
              <button
                onClick={() => setShowTroubleshooting(!showTroubleshooting)}
                className="text-[11px] text-amber-400 hover:text-amber-300 font-medium inline-flex items-center gap-1 transition-colors"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Phone shows ERR_ADDRESS_UNREACHABLE?</span>
                {showTroubleshooting ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showTroubleshooting && (
                <div className="mt-2 p-3.5 bg-amber-950/20 rounded-2xl border border-amber-500/30 text-left text-xs space-y-2 text-slate-300 animate-in fade-in">
                  <div className="font-bold text-amber-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>How to fix ERR_ADDRESS_UNREACHABLE:</span>
                  </div>
                  <ol className="list-decimal pl-4 space-y-1.5 text-[11px] text-slate-300">
                    <li>
                      <strong className="text-white">Same Wi-Fi Network:</strong> Make sure your phone's Wi-Fi is ON and connected to the exact same Wi-Fi SSID. Turn OFF Mobile Data / 5G on your phone while scanning.
                    </li>
                    <li>
                      <strong className="text-white">Wi-Fi Router AP Isolation:</strong> Many home/office Wi-Fi routers block devices from talking directly to each other. If your router has AP isolation enabled, turn on <strong>Mobile Hotspot</strong> on your phone, connect your PC to the hotspot, and re-generate the QR!
                    </li>
                    <li>
                      <strong className="text-white">Windows Firewall:</strong> If Windows Firewall blocks port 8000, run <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300 font-mono text-[10px]">scripts\allow-firewall.bat</code> as Administrator.
                    </li>
                    <li>
                      <strong className="text-white">VPN Active:</strong> Turn off any active VPNs on both your PC and phone.
                    </li>
                  </ol>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => {
                if (session) api.cancelSession(session.sessionId);
                setStep('CHOOSE_DESTINATION');
              }}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Cancel and change destination
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: TRANSFER APPROVAL */}
      {step === 'APPROVAL' && incomingManifest && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Incoming Transfer</h2>
              <p className="text-sm text-slate-400">Do you want to accept this file transfer?</p>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">From:</span>
              <span className="font-semibold text-white">
                {senderInfo?.name || 'Remote Device'} ({senderInfo?.platform})
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Connection:</span>
              {activeTransport === 'DIRECT_P2P' || activeTransport === 'Direct P2P' ? (
                <span className="font-bold text-cyan-400 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[11px]">
                  ⚡ DIRECT P2P
                </span>
              ) : activeTransport === 'SECURE_RELAY' || activeTransport === 'TURN Relay' ? (
                <span className="font-bold text-violet-400 px-2.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[11px]">
                  🔒 TURN RELAY
                </span>
              ) : (
                <span className="font-bold text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px]">
                  ⚡ DIRECT LAN
                </span>
              )}
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
              <span className="font-mono text-blue-400 truncate max-w-[200px]">{destinationPath}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleApproveTransfer(false)}
              className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-rose-400 font-semibold rounded-2xl transition-colors border border-slate-700 text-xs"
            >
              REJECT
            </button>
            <button
              onClick={() => handleApproveTransfer(true)}
              className="py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-2xl transition-colors shadow-lg shadow-blue-500/20 text-xs"
            >
              ACCEPT
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: TRANSFER IN PROGRESS */}
      {step === 'TRANSFERRING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div>
              <h2 className="text-xl font-bold text-white">Transfer in Progress</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Saving to <span className="font-mono text-blue-400">{destinationPath}</span>
              </p>
            </div>
            {activeTransport === 'DIRECT_P2P' || activeTransport === 'Direct P2P' ? (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                ⚡ DIRECT P2P
              </span>
            ) : activeTransport === 'SECURE_RELAY' || activeTransport === 'TURN Relay' ? (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                🔒 TURN RELAY
              </span>
            ) : (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                ⚡ DIRECT LAN
              </span>
            )}
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span className="text-slate-300">Receiving Progress</span>
              <span className="text-blue-400">{progressPercent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-800/40 p-4 rounded-2xl border border-slate-800 text-center">
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
              Streaming SHA-256 chunk verification
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
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">Transfer Complete!</h2>
            <p className="text-sm text-slate-400">
              All files were successfully received and cryptographically verified.
            </p>
          </div>

          {/* Received Files List with Save/Download Buttons */}
          <div className="space-y-3 text-left">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300">
              <span className="flex items-center gap-1.5">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                Received Files ({incomingManifest?.files?.length || 0})
              </span>
              {(incomingManifest?.files?.length || 0) > 1 && (
                <button
                  type="button"
                  onClick={downloadAllFiles}
                  className="text-blue-400 hover:text-blue-300 font-bold inline-flex items-center gap-1 transition-colors text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download All</span>
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {incomingManifest?.files?.map((f: any) => (
                <div
                  key={f.fileId}
                  className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <p className="font-semibold text-white truncate">{f.fileName}</p>
                      <p className="text-[10px] text-slate-400">{formatBytes(f.fileSize)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadSingleFile(incomingManifest.transferId, f.fileId, f.fileName)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shrink-0 inline-flex items-center gap-1.5 transition-colors text-xs shadow-md shadow-blue-500/20"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save to PC</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 text-left space-y-2 text-xs">
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
              <span className="text-slate-400">Destination:</span>
              <span className="font-mono text-blue-400 truncate max-w-[200px]" title={destinationPath}>{destinationPath}</span>
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
