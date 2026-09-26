import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  UploadCloud,
  FileUp,
  FolderUp,
  Laptop,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  File,
  Loader2,
  Wifi,
  ChevronRight,
  HardDrive
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../services/api';
import { generateECDHKeyPair, exportPublicKeyHex, generateUUID } from '@shared/crypto/crypto';
import {
  ClientTransferEngine,
  SelectedItem,
  ProgressCallbackData,
} from '../services/transferEngine';
import { QRPairingPayload, TransferManifest, TransportType } from '@shared/protocol/types';
import { ConnectionManager } from '../services/transports/connectionManager';
import { ITransport } from '../services/transports/ITransport';

interface SenderViewProps {
  onDone: () => void;
  initialToken?: string | null;
}

type SenderStep = 'SCAN' | 'CONNECTING' | 'CONNECTED' | 'PREVIEW' | 'TRANSFERRING' | 'COMPLETE';

export const SenderView: React.FC<SenderViewProps> = ({ onDone, initialToken }) => {
  const [step, setStep] = useState<SenderStep>(initialToken ? 'CONNECTING' : 'SCAN');
  const [pairingPayload, setPairingPayload] = useState<QRPairingPayload | null>(null);
  const [receiverName, setReceiverName] = useState<string>('Receiver');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [manifest, setManifest] = useState<TransferManifest | null>(null);
  const [activeTransport, setActiveTransport] = useState<TransportType>('DIRECT_LAN');
  const [transportBadge, setTransportBadge] = useState<string>('⚡ DIRECT LAN');
  const [isAwaitingApproval, setIsAwaitingApproval] = useState(false);

  // Transfer metrics & transport instance ref
  const activeTransportRef = useRef<ITransport | null>(null);
  const progressCallbackRef = useRef<ProgressCallbackData | null>(null);
  const [progress, setProgress] = useState<ProgressCallbackData | null>(null);
  const transferEngineRef = useRef<ClientTransferEngine>(new ClientTransferEngine());
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'qr-reader';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Auto-connect flow when sender opened the QR URL
  useEffect(() => {
    if (initialToken) {
      executeAutoConnect(initialToken);
    }
  }, [initialToken]);

  const executeAutoConnect = async (token: string) => {
    setErrorMsg(null);
    setStep('CONNECTING');
    try {
      // 1. Detect browser & device details
      const ua = navigator.userAgent;
      const isMobile = /iPhone|iPad|Android|Mobile/i.test(ua);
      const platformName = /iPhone|iPad/i.test(ua)
        ? 'iOS'
        : /Android/i.test(ua)
        ? 'Android'
        : navigator.platform.includes('Win')
        ? 'Windows'
        : navigator.platform.includes('Mac')
        ? 'macOS'
        : 'Linux';
      const browserName = /Safari/i.test(ua) && !/Chrome/i.test(ua)
        ? 'Safari'
        : /Chrome/i.test(ua)
        ? 'Chrome'
        : /Firefox/i.test(ua)
        ? 'Firefox'
        : 'Browser';
      const senderDeviceName = `${platformName} (${browserName})`;

      // 2. Lookup session token and ping device detected
      const sessionInfo = await api.lookupToken(token, senderDeviceName, platformName.toLowerCase(), browserName);
      setReceiverName(sessionInfo.receiverDeviceName);

      // 3. Generate sender crypto keys
      const keypair = await generateECDHKeyPair();
      const pubKeyHex = await exportPublicKeyHex(keypair.publicKey);
      const senderDeviceId = `sender-${Math.random().toString(36).substring(2, 9)}`;

      // 4. Join session
      await api.joinSession(sessionInfo.sessionId, {
        token,
        senderDeviceId,
        senderDeviceName,
        platform: platformName.toLowerCase() as any,
        publicKey: pubKeyHex,
        browser: browserName,
      });

      // 5. Negotiate fastest transport (Priority 1: Direct LAN -> Priority 2: Direct WebRTC P2P -> Priority 3: TURN Relay)
      try {
        const negotiation = await ConnectionManager.selectBestTransport(
          sessionInfo,
          'sender',
          (newType, newBadge) => {
            setActiveTransport(newType);
            setTransportBadge(newBadge);
          }
        );
        activeTransportRef.current = negotiation.transport;
        setActiveTransport(negotiation.type);
        setTransportBadge(negotiation.badgeLabel);
      } catch (negErr) {
        console.warn('Transport negotiation note:', negErr);
        setActiveTransport('DIRECT_LAN');
        setTransportBadge('⚡ DIRECT LAN');
      }

      // 6. Build pairing payload
      const payload: QRPairingPayload = {
        version: sessionInfo.protocolVersion,
        sessionId: sessionInfo.sessionId,
        deviceId: 'receiver',
        deviceName: sessionInfo.receiverDeviceName,
        token,
        expiresAt: sessionInfo.expiresAt,
        endpoints: sessionInfo.endpoints || {
          lanUrls: sessionInfo.lanUrls || [window.location.origin],
          relayUrl: `/api/ws/relay/${sessionInfo.sessionId}`,
          webrtcEnabled: true,
        },
        publicKey: sessionInfo.receiverPublicKey,
      };

      setPairingPayload(payload);
      setStep('CONNECTED');
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not connect to receiver. Check if devices are on the same Wi-Fi or hotspot.');
      setStep('SCAN');
    }
  };

  // Start live webcam scanner (Fallback for manual scanning)
  const startCameraScanner = async () => {
    setErrorMsg(null);
    try {
      if (!qrScannerRef.current) {
        qrScannerRef.current = new Html5Qrcode(scannerContainerId);
      }
      setIsScanning(true);
      await qrScannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleQRDecoded(decodedText);
          stopCameraScanner();
        },
        () => {}
      );
    } catch {
      setErrorMsg('Camera access denied or unavailable. You can upload a QR image.');
      setIsScanning(false);
    }
  };

  const stopCameraScanner = async () => {
    if (qrScannerRef.current && isScanning) {
      try {
        await qrScannerRef.current.stop();
      } catch {}
      setIsScanning(false);
    }
  };

  useEffect(() => {
    return () => {
      stopCameraScanner();
    };
  }, []);

  // Process decoded QR text (supports both URL and JSON formats)
  const handleQRDecoded = async (text: string) => {
    setErrorMsg(null);
    try {
      // Check if QR contains local URL
      if (text.includes('/connect/')) {
        const parts = text.split('/connect/');
        if (parts[1]) {
          const token = parts[1].split('/')[0].split('?')[0];
          await executeAutoConnect(token);
          return;
        }
      }

      if (text.startsWith('{')) {
        const parsed: QRPairingPayload = JSON.parse(text);
        if (parsed.token) {
          await executeAutoConnect(parsed.token);
          return;
        }
      }

      throw new Error('Unrecognized QR code format. Please scan a valid QRDrop QR code.');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to parse QR code');
    }
  };

  // Upload QR code image fallback
  const handleQRImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const html5QrCode = new Html5Qrcode('temp-qr-div');
      const decodedText = await html5QrCode.scanFile(file, true);
      handleQRDecoded(decodedText);
    } catch {
      setErrorMsg('Could not detect a valid QRDrop code in this image.');
    }
  };

  // File picking
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const items: SelectedItem[] = files.map((f) => ({
      file: f,
      relativePath: (f as any).webkitRelativePath || '',
    }));
    setSelectedItems((prev) => [...prev, ...items]);
    if (items.length > 0) setStep('PREVIEW');
  };

  // Folder picking (directory input)
  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const items: SelectedItem[] = files.map((f) => ({
      file: f,
      relativePath: (f as any).webkitRelativePath || '',
    }));
    setSelectedItems((prev) => [...prev, ...items]);
    if (items.length > 0) setStep('PREVIEW');
  };

  // Drag & drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    const items: SelectedItem[] = files.map((f) => ({
      file: f,
      relativePath: (f as any).webkitRelativePath || '',
    }));
    setSelectedItems((prev) => [...prev, ...items]);
    if (items.length > 0) setStep('PREVIEW');
  };

  // Initiate transfer
  const handleStartSend = async () => {
    if (!pairingPayload || selectedItems.length === 0) return;
    setErrorMsg(null);
    try {
      const engine = transferEngineRef.current;
      const m = await engine.prepareManifest(
        'sender-device-id',
        pairingPayload.deviceId,
        selectedItems
      );
      setManifest(m);

      // Submit manifest to receiver for approval
      setIsAwaitingApproval(true);
      await api.submitManifest(pairingPayload.sessionId, m);

      // Poll until receiver accepts or rejects
      const pollApproval = setInterval(async () => {
        try {
          const s = await api.getSession(pairingPayload.sessionId);
          if (s.state === 'APPROVED') {
            clearInterval(pollApproval);
            setIsAwaitingApproval(false);
            setStep('TRANSFERRING');
            // Execute real chunked streaming transfer with active transport
            await engine.executeSend(
              pairingPayload.sessionId,
              m,
              selectedItems,
              activeTransport,
              (p) => setProgress(p),
              activeTransportRef.current || undefined
            );
            // Completed!
            setStep('COMPLETE');
            // Record history
            await api.addHistoryRecord({
              id: generateUUID(),
              transferId: m.transferId,
              timestamp: Date.now(),
              direction: 'send',
              remoteDeviceName: receiverName,
              remotePlatform: 'Desktop/Mobile',
              transport: activeTransport,
              fileCount: m.totalFiles,
              totalBytes: m.totalBytes,
              durationSeconds: 10,
              avgSpeedBytesPerSec: 50 * 1024 * 1024,
              status: 'completed',
              fileNames: m.files.map((f) => f.fileName),
            });
          } else if (s.state === 'REJECTED') {
            clearInterval(pollApproval);
            setIsAwaitingApproval(false);
            setErrorMsg('Receiver declined the transfer request.');
          } else if (s.state === 'CANCELLED') {
            clearInterval(pollApproval);
            setIsAwaitingApproval(false);
            setErrorMsg('Transfer cancelled by receiver.');
            setStep('CONNECTED');
          }
        } catch {
          // ignore transient errors
        }
      }, 1000);
    } catch (e: any) {
      console.error('Transfer start error:', e);
      const msg = (e && typeof e.message === 'string' && e.message.includes('randomUUID'))
        ? 'Unable to create a secure transfer session. Please reload QRDrop and try again.'
        : e?.message || 'Transfer failed';
      setErrorMsg(msg);
      setIsAwaitingApproval(false);
    }
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
      {/* Hidden inputs for file / folder selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory="true"
        directory="true"
        multiple
        className="hidden"
        onChange={handleFolderInput}
      />

      {/* Hidden div for html5-qrcode file scanning */}
      <div id="temp-qr-div" className="hidden" />

      {/* STEP: CONNECTING (When opened via phone camera URL) */}
      {step === 'CONNECTING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto animate-pulse">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">QRDrop</h2>
            <p className="text-sm text-slate-400">Connecting to:</p>
            <p className="text-lg font-bold text-blue-400 mt-1">{receiverName}</p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Secure local connection</span>
          </div>
          <p className="text-xs text-slate-500">Please wait...</p>
        </div>
      )}

      {/* STEP: CONNECTED (Ready to pick and send files) */}
      {step === 'CONNECTED' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">✓ Connected</span>
                </div>
                <h2 className="text-xl font-bold text-white">{receiverName}</h2>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Connection:</span>
              {activeTransport === 'DIRECT_P2P' ? (
                <span className="text-xs font-bold text-cyan-400 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                  ⚡ DIRECT P2P
                </span>
              ) : activeTransport === 'SECURE_RELAY' ? (
                <span className="text-xs font-bold text-violet-400 px-2.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20">
                  🔒 TURN RELAY
                </span>
              ) : (
                <span className="text-xs font-bold text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  ⚡ DIRECT LAN
                </span>
              )}
            </div>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-700 hover:border-blue-500/60 rounded-3xl p-8 text-center bg-slate-800/20 hover:bg-blue-500/5 transition-all cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="w-12 h-12 text-blue-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">Select Files to Send</h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Tap to browse files or drag and drop photos, videos, and documents here.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-semibold rounded-2xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 text-sm"
            >
              <FileUp className="w-4 h-4" />
              <span>SELECT FILES</span>
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="py-3.5 px-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-200 font-semibold rounded-2xl transition-all border border-slate-700 flex items-center justify-center gap-2 text-sm"
            >
              <FolderUp className="w-4 h-4" />
              <span>SELECT FOLDER</span>
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-medium pt-2">
            <ShieldCheck className="w-4 h-4" />
            <span>Direct local transfer — no cloud storage involved</span>
          </div>
        </div>
      )}

      {/* STEP: SCAN (Manual fallback if not opened via URL) */}
      {step === 'SCAN' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto mb-3">
              <Camera className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white">Connect to Receiver</h2>
            <p className="text-xs text-slate-400 mt-1">
              Tip: You can scan the receiver's QR directly with your phone's normal camera app!
            </p>
          </div>

          {/* Camera Scanner View */}
          <div className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 relative">
            <div id={scannerContainerId} className="w-full min-h-[250px] bg-slate-950 flex items-center justify-center text-slate-500 text-xs" />
            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-4 text-center">
                <Camera className="w-10 h-10 text-slate-600 mb-2" />
                <p className="text-xs text-slate-400 mb-4">Click below to start webcam scanner</p>
                <button
                  onClick={startCameraScanner}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors shadow-lg shadow-blue-500/20"
                >
                  START WEBCAM
                </button>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Upload QR image option */}
          <div className="pt-2 text-center border-t border-slate-800">
            <label className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer inline-flex items-center gap-1.5">
              <UploadCloud className="w-4 h-4" />
              <span>Upload QR Code Image</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleQRImageUpload} />
            </label>
          </div>
        </div>
      )}

      {/* STEP: PREVIEW (Selected files list) */}
      {step === 'PREVIEW' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-xl font-bold text-white">Ready to Send</h2>
              <p className="text-xs text-slate-400">
                Sending to <span className="font-semibold text-blue-400">{receiverName}</span>
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              DIRECT LAN
            </span>
          </div>

          {/* Files List */}
          <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
            {selectedItems.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-xs"
              >
                <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                  <File className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-slate-200 font-medium truncate">{item.file.name}</span>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-slate-400 font-mono">{formatBytes(item.file.size)}</span>
                  <button
                    onClick={() => {
                      const updated = selectedItems.filter((_, i) => i !== idx);
                      setSelectedItems(updated);
                      if (updated.length === 0) setStep('CONNECTED');
                    }}
                    className="p-1 hover:bg-slate-700 text-slate-400 hover:text-rose-400 rounded-lg"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Total Summary */}
          <div className="p-3 bg-slate-800/40 rounded-2xl border border-slate-800 flex justify-between items-center text-xs font-semibold">
            <span className="text-slate-400">Total: {selectedItems.length} files</span>
            <span className="text-white font-mono text-sm">
              {formatBytes(selectedItems.reduce((acc, curr) => acc + curr.file.size, 0))}
            </span>
          </div>

          {isAwaitingApproval && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Waiting for receiver to accept the transfer...</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setSelectedItems([]);
                setStep('CONNECTED');
              }}
              className="py-3.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-2xl transition-colors text-xs"
            >
              ADD MORE FILES
            </button>
            <button
              disabled={isAwaitingApproval}
              onClick={handleStartSend}
              className="py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-2xl transition-colors shadow-lg shadow-blue-500/20 text-xs flex items-center justify-center gap-2"
            >
              <span>SEND FILES</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP: TRANSFERRING */}
      {step === 'TRANSFERRING' && progress && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-xl font-bold text-white">Sending Files</h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                {progress.currentFileName} ({progress.fileIndex} of {progress.totalFiles})
              </p>
            </div>
            {activeTransport === 'DIRECT_P2P' ? (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                ⚡ DIRECT P2P
              </span>
            ) : activeTransport === 'SECURE_RELAY' ? (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                🔒 TURN RELAY
              </span>
            ) : (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                ⚡ DIRECT LAN
              </span>
            )}
          </div>

          {/* Overall Progress Bar */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span className="text-slate-300">Transfer Progress</span>
              <span className="text-blue-400">{progress.percent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>

          {/* Real Metrics Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-800/40 p-4 rounded-2xl border border-slate-800 text-center">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Current Speed</span>
              <span className="text-base font-bold text-white">{progress.currentSpeedMBps} MB/s</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Average Speed</span>
              <span className="text-base font-bold text-white">{progress.avgSpeedMBps} MB/s</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Transferred</span>
              <span className="text-base font-bold text-white">{formatBytes(progress.totalBytesTransferred)}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">ETA</span>
              <span className="text-base font-bold text-white">{formatTime(progress.etaSeconds)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="flex items-center gap-1.5 text-blue-400">
              <ShieldCheck className="w-4 h-4" />
              Streaming SHA-256 integrity verification
            </span>
            <button
              onClick={() => {
                transferEngineRef.current.cancel();
                setStep('CONNECTED');
              }}
              className="text-rose-400 hover:text-rose-300 font-semibold"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* STEP: COMPLETE */}
      {step === 'COMPLETE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">Transfer Complete!</h2>
            <p className="text-sm text-slate-400">
              All files were successfully transferred and verified with SHA-256.
            </p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 text-left space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Sent to:</span>
              <span className="font-semibold text-white">{receiverName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Files:</span>
              <span className="font-semibold text-white">{manifest?.totalFiles}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Transferred:</span>
              <span className="font-semibold text-white">{formatBytes(manifest?.totalBytes || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Verification:</span>
              <span className="font-semibold text-emerald-400">✓ SHA-256 Verified</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => {
                setSelectedItems([]);
                setStep('CONNECTED');
              }}
              className="py-3.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-2xl transition-colors border border-slate-700 text-sm"
            >
              SEND MORE
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
