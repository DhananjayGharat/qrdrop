/**
 * QRDrop WebRTC P2P DataChannel Service
 * Implements direct browser-to-browser / device-to-device transport via RTCDataChannel.
 */

export interface WebRTCCallbacks {
  onChannelOpen?: () => void;
  onChannelClose?: () => void;
  onBinaryChunk?: (data: ArrayBuffer) => void;
  onTextMessage?: (data: any) => void;
}

export class WebRTCConnection {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingSocket: WebSocket | null = null;
  private isInitiator = false;
  private callbacks: WebRTCCallbacks = {};

  constructor(
    private sessionId: string,
    private role: 'receiver' | 'sender',
    private stunServers: string[] = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']
  ) {}

  public async connectSignaling(callbacks: WebRTCCallbacks = {}): Promise<void> {
    this.callbacks = callbacks;
    this.isInitiator = this.role === 'sender';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/signal/${this.sessionId}?role=${this.role}`;
    
    this.signalingSocket = new WebSocket(wsUrl);

    this.signalingSocket.onopen = () => {
      this.initPeerConnection();
    };

    this.signalingSocket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleSignalingMessage(msg);
      } catch (err) {
        console.error('Signaling message error:', err);
      }
    };
  }

  private initPeerConnection() {
    const iceServers = this.stunServers.map(url => ({ urls: url }));
    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.signalingSocket?.readyState === WebSocket.OPEN) {
        this.signalingSocket.send(JSON.stringify({
          type: 'ICE_CANDIDATE',
          candidate: event.candidate,
        }));
      }
    };

    if (this.isInitiator) {
      // Sender creates the DataChannel
      this.dataChannel = this.pc.createDataChannel('qrdrop-transfer', {
        ordered: true,
      });
      this.setupDataChannel(this.dataChannel);

      this.pc.onnegotiationneeded = async () => {
        try {
          if (!this.pc) return;
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.signalingSocket?.send(JSON.stringify({
            type: 'SDP_OFFER',
            sdp: this.pc.localDescription,
          }));
        } catch (e) {
          console.error('Failed to create offer:', e);
        }
      };
    } else {
      // Receiver listens for incoming DataChannel
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      console.log('WebRTC DataChannel is OPEN');
      this.callbacks.onChannelOpen?.();
    };
    channel.onclose = () => {
      console.log('WebRTC DataChannel CLOSED');
      this.callbacks.onChannelClose?.();
    };
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          this.callbacks.onTextMessage?.(parsed);
        } catch {
          this.callbacks.onTextMessage?.(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.callbacks.onBinaryChunk?.(event.data);
      }
    };
  }

  private async handleSignalingMessage(msg: any) {
    if (!this.pc) return;

    if (msg.type === 'SDP_OFFER') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signalingSocket?.send(JSON.stringify({
        type: 'SDP_ANSWER',
        sdp: this.pc.localDescription,
      }));
    } else if (msg.type === 'SDP_ANSWER') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ICE_CANDIDATE' && msg.candidate) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (err) {
        console.warn('Error adding ICE candidate:', err);
      }
    } else if (msg.type === 'TRANSFER_REQUEST' || msg.type === 'TRANSFER_ACCEPT' || msg.type === 'TRANSFER_REJECT' || msg.type === 'CANCEL') {
      this.callbacks.onTextMessage?.(msg);
    }
  }

  public sendBinary(data: ArrayBuffer): boolean {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      // Buffer backpressure check: wait if buffer exceeds 16MB
      if (this.dataChannel.bufferedAmount > 16 * 1024 * 1024) {
        return false;
      }
      this.dataChannel.send(data);
      return true;
    }
    return false;
  }

  public sendText(data: any): boolean {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(text);
      return true;
    } else if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(text);
      return true;
    }
    return false;
  }

  public get isConnected(): boolean {
    return this.dataChannel !== null && this.dataChannel.readyState === 'open';
  }

  public close() {
    this.dataChannel?.close();
    this.pc?.close();
    this.signalingSocket?.close();
  }
}
