import { TokenLookupResponse, TransportType } from '@shared/protocol/types';
import { ITransport } from './ITransport';
import { LanTransport } from './LanTransport';
import { WebRtcTransport } from './WebRtcTransport';

export interface TransportNegotiationResult {
  transport: ITransport;
  type: TransportType;
  badgeLabel: string;
  endpointUrl?: string;
}

export class ConnectionManager {
  /**
   * Automatically probes endpoints and selects the fastest, most direct transport:
   * 1. Priority 1: Direct LAN (⚡ DIRECT LAN) - probed via local /health check
   * 2. Priority 2: Direct WebRTC P2P (⚡ DIRECT P2P) - browser-to-browser
   * 3. Priority 3: TURN Relay (🔒 TURN RELAY) - fallback via Coturn/TURN
   */
  public static async selectBestTransport(
    sessionInfo: TokenLookupResponse,
    role: 'sender' | 'receiver' = 'sender',
    onConnectionChange?: (type: TransportType, label: string) => void
  ): Promise<TransportNegotiationResult> {
    // 1. Probe LAN URLs for Direct LAN (Priority 1)
    const lanCandidates = sessionInfo.lanUrls || sessionInfo.endpoints?.lanUrls || [];
    
    // Also include window.location.origin if it looks like a local IP or localhost
    const origin = window.location.origin;
    if (
      (origin.includes('192.168.') || origin.includes('10.') || origin.includes('172.') || origin.includes('localhost') || origin.includes('127.0.0.1')) &&
      !lanCandidates.includes(origin)
    ) {
      lanCandidates.unshift(origin);
    }

    for (const url of lanCandidates) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s fast probe
        const probeRes = await fetch(`${url}/health`, {
          method: 'GET',
          signal: controller.signal,
          mode: 'cors',
        });
        clearTimeout(timeoutId);

        if (probeRes.ok) {
          console.log(`Direct LAN reachable at ${url}`);
          const lanTransport = new LanTransport(url);
          return {
            transport: lanTransport,
            type: 'DIRECT_LAN',
            badgeLabel: '⚡ DIRECT LAN',
            endpointUrl: url,
          };
        }
      } catch (err) {
        // Probe failed for this candidate, try next
      }
    }

    // 2. Direct LAN unreachable (different networks, cellular, or firewall)
    // Fall back to WebRTC (Direct P2P or TURN Relay)
    console.log('LAN probe unreachable. Falling back to WebRTC P2P / TURN Relay...');
    const iceServers = sessionInfo.iceServers || sessionInfo.endpoints?.iceServers || [];
    const signalingUrl = sessionInfo.endpoints?.signalingUrl || `/api/ws/signal/${sessionInfo.sessionId}`;

    const webrtc = new WebRtcTransport({
      sessionId: sessionInfo.sessionId,
      role,
      iceServers,
      signalingUrl,
      onConnectionChange,
    });

    try {
      await webrtc.initialize();
      return {
        transport: webrtc,
        type: webrtc.type,
        badgeLabel: webrtc.badgeLabel,
      };
    } catch (err) {
      console.warn('WebRTC initialization failed, falling back to basic LAN transport:', err);
      // Fallback to origin
      const fallbackLan = new LanTransport(window.location.origin);
      return {
        transport: fallbackLan,
        type: 'DIRECT_LAN',
        badgeLabel: '⚡ DIRECT LAN',
        endpointUrl: window.location.origin,
      };
    }
  }
}
