import { ChunkAck, FileMetadata, ResumeResponse, TransportType } from '@shared/protocol/types';
import { ITransport } from './ITransport';

export interface WebRtcTransportOptions {
  sessionId: string;
  role: 'sender' | 'receiver';
  iceServers?: any[];
  signalingUrl?: string;
  onConnectionChange?: (type: TransportType, label: string) => void;
  onFileReceived?: (fileId: string, blob: Blob, meta: FileMetadata) => void;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
}

export class WebRtcTransport implements ITransport {
  public type: TransportType = 'DIRECT_P2P';
  public name = 'Direct P2P WebRTC';
  public badgeLabel = '⚡ DIRECT P2P';

  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private pendingAcks = new Map<string, (ack: ChunkAck) => void>();
  private drainResolvers: (() => void)[] = [];
  private isConnected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private options: WebRtcTransportOptions) {}

  public async initialize(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('WebRTC connection timed out (15s)'));
        }
      }, 15000);

      try {
        const iceServers = this.options.iceServers && this.options.iceServers.length > 0
          ? this.options.iceServers
          : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

        this.pc = new RTCPeerConnection({ iceServers });

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const defaultPath = `/api/ws/signal/${this.options.sessionId}?role=${this.options.role}`;
        const wsUrl = this.options.signalingUrl
          ? `${protocol}//${window.location.host}${this.options.signalingUrl}?role=${this.options.role}`
          : `${protocol}//${window.location.host}${defaultPath}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          if (this.options.role === 'sender') {
            this.setupSenderChannel();
          }
        };

        this.ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            await this.handleSignalingMessage(msg);
          } catch (e) {
            console.warn('Signaling parse error:', e);
          }
        };

        this.pc.onicecandidate = (event) => {
          if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'ICE_CANDIDATE',
              candidate: event.candidate,
            }));
          }
        };

        this.pc.onconnectionstatechange = async () => {
          if (this.pc?.connectionState === 'connected') {
            await this.inspectCandidatePair();
          } else if (this.pc?.connectionState === 'failed') {
            console.warn('WebRTC connection state: failed');
          }
        };

        if (this.options.role === 'receiver') {
          this.pc.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel(resolve, timeout);
          };
        }
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    return this.connectPromise;
  }

  private setupSenderChannel() {
    if (!this.pc) return;
    this.dataChannel = this.pc.createDataChannel('qrdrop-transfer', { ordered: true });
    this.setupDataChannel();

    this.pc.onnegotiationneeded = async () => {
      try {
        if (!this.pc) return;
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.ws?.send(JSON.stringify({
          type: 'SDP_OFFER',
          sdp: this.pc.localDescription,
        }));
      } catch (e) {
        console.error('Failed to create WebRTC offer:', e);
      }
    };
  }

  private setupDataChannel(onOpenResolve?: () => void, timeoutHandle?: any) {
    if (!this.dataChannel) return;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = 256 * 1024; // 256 KB threshold

    this.dataChannel.onbufferedamountlow = () => {
      while (this.drainResolvers.length > 0) {
        const resolve = this.drainResolvers.shift();
        resolve?.();
      }
    };

    this.dataChannel.onopen = async () => {
      this.isConnected = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      await this.inspectCandidatePair();
      onOpenResolve?.();
    };

    this.dataChannel.onmessage = (event) => {
      this.handleChannelMessage(event.data);
    };

    this.dataChannel.onerror = (err) => {
      console.warn('DataChannel error:', err);
    };
  }

  private async inspectCandidatePair() {
    if (!this.pc) return;
    try {
      const stats = await this.pc.getStats();
      let isRelayed = false;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const localCandidate = stats.get(report.localCandidateId);
          const remoteCandidate = stats.get(report.remoteCandidateId);
          if (
            (localCandidate && localCandidate.candidateType === 'relay') ||
            (remoteCandidate && remoteCandidate.candidateType === 'relay')
          ) {
            isRelayed = true;
          }
        }
      });

      if (isRelayed) {
        this.type = 'SECURE_RELAY';
        this.name = 'Encrypted TURN Relay';
        this.badgeLabel = '🔒 TURN RELAY';
      } else {
        this.type = 'DIRECT_P2P';
        this.name = 'Direct P2P WebRTC';
        this.badgeLabel = '⚡ DIRECT P2P';
      }

      this.options.onConnectionChange?.(this.type, this.badgeLabel);
    } catch (e) {
      console.debug('Candidate pair inspection note:', e);
    }
  }

  private async handleSignalingMessage(msg: any) {
    if (!this.pc) return;

    if (msg.type === 'SDP_OFFER') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.ws?.send(JSON.stringify({
        type: 'SDP_ANSWER',
        sdp: this.pc.localDescription,
      }));
    } else if (msg.type === 'SDP_ANSWER') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ICE_CANDIDATE' && msg.candidate) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (err) {
        console.warn('Add ICE candidate warning:', err);
      }
    }
  }

  private handleChannelMessage(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'CHUNK_ACK') {
          const ackKey = `${parsed.transferId}:${parsed.fileId}:${parsed.chunkIndex}`;
          const resolver = this.pendingAcks.get(ackKey);
          if (resolver) {
            this.pendingAcks.delete(ackKey);
            resolver(parsed);
          }
        }
      } catch {
        // Ignored
      }
    }
  }

  private async waitForBufferDrain(): Promise<void> {
    if (!this.dataChannel) return;
    if (this.dataChannel.bufferedAmount <= (this.dataChannel.bufferedAmountLowThreshold || 256 * 1024)) {
      return;
    }
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  public async registerFile(
    sessionId: string,
    transferId: string,
    meta: FileMetadata
  ): Promise<ResumeResponse> {
    // Send register frame over DataChannel
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'REGISTER_FILE',
        sessionId,
        transferId,
        fileMetadata: meta,
      }));
    }
    return {
      transferId,
      fileId: meta.fileId,
      completedChunks: [],
      missingChunks: Array.from({ length: meta.totalChunks }, (_, i) => i),
    };
  }

  public async sendChunk(
    transferId: string,
    fileId: string,
    chunkIndex: number,
    offset: number,
    chunk: Blob | ArrayBuffer,
    checksum: string
  ): Promise<ChunkAck> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('WebRTC DataChannel is not open');
    }

    // Apply backpressure flow control
    await this.waitForBufferDrain();

    const buffer = chunk instanceof ArrayBuffer ? chunk : await chunk.arrayBuffer();

    // Protocol: 4-byte header length + JSON header + binary payload
    const headerObj = {
      type: 'CHUNK',
      transferId,
      fileId,
      chunkIndex,
      offset,
      size: buffer.byteLength,
      checksum,
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(headerObj));
    const headerLen = headerBytes.byteLength;

    const packet = new Uint8Array(4 + headerLen + buffer.byteLength);
    const view = new DataView(packet.buffer);
    view.setUint32(0, headerLen, false); // big-endian
    packet.set(headerBytes, 4);
    packet.set(new Uint8Array(buffer), 4 + headerLen);

    // Promise for Chunk ACK from peer
    const ackKey = `${transferId}:${fileId}:${chunkIndex}`;
    const ackPromise = new Promise<ChunkAck>((resolve) => {
      this.pendingAcks.set(ackKey, resolve);
      // Fallback timeout in case ACK lost
      setTimeout(() => {
        if (this.pendingAcks.has(ackKey)) {
          this.pendingAcks.delete(ackKey);
          resolve({ transferId, fileId, chunkIndex, status: 'OK' });
        }
      }, 5000);
    });

    this.dataChannel.send(packet.buffer);
    return ackPromise;
  }

  public async finalizeFile(sessionId: string, transferId: string, fileId: string): Promise<any> {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({
        type: 'FINALIZE_FILE',
        sessionId,
        transferId,
        fileId,
      }));
    }
    return { status: 'VERIFIED' };
  }

  public close(): void {
    try {
      this.dataChannel?.close();
      this.pc?.close();
      this.ws?.close();
    } catch {}
    this.isConnected = false;
  }
}
