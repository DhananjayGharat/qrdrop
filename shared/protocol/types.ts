/**
 * QRDrop Protocol Specification: QRDTP/1
 * Platform-independent protocol definition for universal file transfers.
 */

export const PROTOCOL_VERSION = 'QRDTP/1';

export type SessionState =
  | 'CREATED'
  | 'QR_GENERATED'
  | 'WAITING'
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
  relayUrl: string;       // e.g. "ws://signal.qrdrop.io/api/relay/{sessionId}"
  webrtcEnabled: boolean;
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
}

export interface SessionCreateRequest {
  receiverDeviceId: string;
  receiverDeviceName: string;
  destinationPath: string;
  platform: PlatformType;
  publicKey: string;
}

export interface SessionCreateResponse {
  sessionId: string;
  token: string;
  expiresAt: number;
  qrPayload: string;
  qrDataUri: string;
  state: SessionState;
  endpoints: SessionEndpoints;
}

export interface SessionJoinRequest {
  token: string;
  senderDeviceId: string;
  senderDeviceName: string;
  platform: PlatformType;
  publicKey: string;
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
  acceptedMissingChunks: number[];
}

export interface TransferProgress {
  transferId: string;
  fileIndex: number;
  currentFileName: string;
  currentFileBytes: number;
  currentFileSize: number;
  totalBytesTransferred: number;
  totalBytes: number;
  currentSpeedBytesPerSec: number;
  avgSpeedBytesPerSec: number;
  etaSeconds: number;
  state: SessionState;
  activeTransport: TransportType;
}

export interface TransferHistoryRecord {
  id: string;
  transferId: string;
  timestamp: number;
  direction: 'send' | 'receive';
  remoteDeviceName: string;
  remotePlatform: PlatformType;
  transport: TransportType;
  fileCount: number;
  totalBytes: number;
  durationSeconds: number;
  avgSpeedBytesPerSec: number;
  status: 'completed' | 'failed' | 'cancelled';
  fileNames: string[];
}
