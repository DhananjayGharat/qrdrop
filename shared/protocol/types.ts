/**
 * QRDrop Protocol Specification: QRDTP/1
 * Platform-independent protocol definition for universal file transfers.
 */

export const PROTOCOL_VERSION = 'QRDTP/1';

export type SessionState =
  | 'NETWORK_CHECKING'
  | 'NETWORK_READY'
  | 'CREATED'
  | 'QR_GENERATED'
  | 'WAITING'
  | 'WAITING_FOR_SCAN'
  | 'DEVICE_DETECTED'
  | 'PAIRING'
  | 'CONNECTED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'TRANSFERRING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'DISCONNECTED';

export type TransportType = 'DIRECT_LAN' | 'DIRECT_P2P' | 'SECURE_RELAY';

export type PlatformType = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web';

export type MessageType =
  | 'HELLO'
  | 'PAIR_REQUEST'
  | 'PAIR_ACCEPT'
  | 'PAIR_REJECT'
  | 'DEVICE_DETECTED'
  | 'CAPABILITIES'
  | 'TRANSFER_REQUEST'
  | 'TRANSFER_ACCEPT'
  | 'TRANSFER_REJECT'
  | 'MANIFEST'
  | 'CHUNK'
  | 'CHUNK_ACK'
  | 'CHUNK_RETRY'
  | 'RESUME_REQUEST'
  | 'RESUME_RESPONSE'
  | 'HASH_VERIFY'
  | 'TRANSFER_COMPLETE'
  | 'CANCEL'
  | 'ERROR';

export interface DeviceInfo {
  deviceId: string;
  name: string;
  platform: PlatformType;
  appVersion: string;
  capabilities: DeviceCapabilities;
}

export interface DeviceCapabilities {
  protocolVersions: string[];
  transports: TransportType[];
  encryption: ('AES-256-GCM' | 'NONE')[];
  chunking: boolean;
  resume: boolean;
  folderTransfer: boolean;
  recommendedChunkSize: number;
}

export interface SessionEndpoints {
  lanUrls: string[];      // e.g. ["http://192.168.1.100:8000"]
  relayUrl: string;       // e.g. "/api/ws/relay/{sessionId}"
  signalingUrl?: string;  // e.g. "/ws/signaling/{sessionId}"
  webrtcEnabled: boolean;
  iceServers?: any[];
  publicConnectUrl?: string;
  lanConnectUrl?: string;
}

export interface QRPairingPayload {
  version: string;
  sessionId: string;
  deviceId: string;
  deviceName: string;
  token: string;
  expiresAt: number;     // Unix timestamp (ms)
  endpoints: SessionEndpoints;
  publicKey: string;     // Hex/Base64 ECDH public key
  connectUrl?: string;
}

export interface SessionCreateRequest {
  receiverDeviceId: string;
  receiverDeviceName: string;
  destinationPath: string;
  platform: PlatformType;
  publicKey: string;
  selectedIp?: string;
  preferLocalQr?: boolean;
  clientOrigin?: string;
}

export interface SessionCreateResponse {
  sessionId: string;
  token: string;
  expiresAt: number;
  qrPayload: string;
  qrDataUri: string;
  state: SessionState;
  endpoints: SessionEndpoints;
  connectUrl?: string;
  lanConnectUrl?: string;
  globalConnectUrl?: string;
  networkInfo?: NetworkDiagnostics;
}

export interface SessionJoinRequest {
  token: string;
  senderDeviceId: string;
  senderDeviceName: string;
  platform: PlatformType;
  publicKey: string;
  browser?: string;
}

export interface TokenLookupResponse {
  valid: boolean;
  sessionId: string;
  receiverDeviceName: string;
  receiverPlatform: string;
  receiverPublicKey: string;
  expiresAt: number;
  state: string;
  protocolVersion: string;
  networkType: string;
  isHotspot: boolean;
  lanUrls?: string[];
  endpoints?: SessionEndpoints;
  iceServers?: any[];
}

export interface NetworkDiagnostics {
  status: string;
  bindHost?: string;
  interfaceName: string;
  primaryIp: string;
  port: number;
  portListening: boolean;
  isReachable?: boolean;
  networkType: string;
  isHotspot: boolean;
  statusMessage: string;
  protocolVersion: string;
  firewallStatus: string;
  lanUrl?: string;
  healthCheck?: {
    reachable: boolean;
    serverListening: boolean;
    statusCode: number | null;
    url: string;
    error: string | null;
    advisory: string | null;
  };
  troubleshootingTips?: string[];
  candidateInterfaces?: Array<{
    interface: string;
    ip: string;
    networkType: string;
    isHotspot: boolean;
    isUp: boolean;
    isVirtual: boolean;
    score: number;
    isDefaultRoute?: boolean;
    hasTraffic?: boolean;
  }>;
}

export interface FileMetadata {
  fileId: string;
  fileName: string;
  relativePath: string;  // For folder structures, e.g. "my_folder/assets/logo.png"
  fileSize: number;      // Total bytes
  mimeType: string;
  sha256Hash?: string;   // Computed before sending or after full verification
  totalChunks: number;
  chunkSize: number;
}

export interface TransferManifest {
  transferId: string;
  senderDeviceId: string;
  receiverDeviceId: string;
  totalFiles: number;
  totalBytes: number;
  createdAt: number;
  files: FileMetadata[];
}

export interface ChunkHeader {
  transferId: string;
  fileId: string;
  chunkIndex: number;
  offset: number;
  size: number;
  checksum: string;      // SHA-256 hex of chunk or CRC32
}

export interface ChunkAck {
  transferId: string;
  fileId: string;
  chunkIndex: number;
  status: 'OK' | 'CORRUPT' | 'MISSING';
}

export interface ResumeRequest {
  transferId: string;
  fileId: string;
  knownCompletedChunks: number[];
}

export interface ResumeResponse {
  transferId: string;
  fileId: string;
  completedChunks: number[];
  missingChunks: number[];
}

export interface TransferHistoryRecord {
  id: string;
  transferId: string;
  timestamp: number;
  direction: 'send' | 'receive';
  remoteDeviceName: string;
  remotePlatform: string;
  transport: string;
  fileCount: number;
  totalBytes: number;
  durationSeconds: number;
  avgSpeedBytesPerSec: number;
  status: 'completed' | 'failed' | 'cancelled';
  fileNames: string[];
}
