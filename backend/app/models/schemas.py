from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from backend.app.core.state import SessionState

class DeviceCapabilities(BaseModel):
    protocolVersions: List[str] = Field(default_factory=lambda: ["QRDTP/1"])
    transports: List[str] = Field(default_factory=lambda: ["DIRECT_LAN", "DIRECT_P2P", "SECURE_RELAY"])
    encryption: List[str] = Field(default_factory=lambda: ["AES-256-GCM"])
    chunking: bool = True
    resume: bool = True
    folderTransfer: bool = True
    recommendedChunkSize: int = 256 * 1024

class DeviceInfo(BaseModel):
    deviceId: str
    name: str
    platform: str
    appVersion: str = "2.0.0"
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)

class SessionEndpoints(BaseModel):
    lanUrls: List[str] = Field(default_factory=list)
    relayUrl: str = ""
    signalingUrl: str = ""
    webrtcEnabled: bool = True
    iceServers: List[Dict[str, Any]] = Field(default_factory=list)
    publicConnectUrl: Optional[str] = None
    lanConnectUrl: Optional[str] = None

class QRPairingPayload(BaseModel):
    version: str = "QRDTP/1"
    sessionId: str
    deviceId: str
    deviceName: str
    token: str
    expiresAt: float
    endpoints: SessionEndpoints
    publicKey: str
    connectUrl: Optional[str] = None

class SessionCreateRequest(BaseModel):
    receiverDeviceId: str
    receiverDeviceName: str
    destinationPath: str
    platform: str
    publicKey: str
    selectedIp: Optional[str] = None
    preferLocalQr: bool = False

class SessionCreateResponse(BaseModel):
    sessionId: str
    token: str
    expiresAt: float
    qrPayload: str
    qrDataUri: str
    state: SessionState
    endpoints: SessionEndpoints
    connectUrl: str = ""
    lanConnectUrl: str = ""
    globalConnectUrl: str = ""
    networkInfo: Optional[Dict[str, Any]] = None

class SessionJoinRequest(BaseModel):
    token: str
    senderDeviceId: str
    senderDeviceName: str
    platform: str
    publicKey: str
    browser: Optional[str] = None

class DeviceDetectRequest(BaseModel):
    token: str
    clientPlatform: Optional[str] = None
    clientDeviceName: Optional[str] = None
    browser: Optional[str] = None

class TokenLookupResponse(BaseModel):
    valid: bool
    sessionId: str
    receiverDeviceName: str
    receiverPlatform: str
    receiverPublicKey: str
    expiresAt: float
    state: str
    protocolVersion: str = "QRDTP/1"
    networkType: str = "WI-FI"
    isHotspot: bool = False
    lanUrls: List[str] = Field(default_factory=list)
    endpoints: Optional[SessionEndpoints] = None
    iceServers: List[Dict[str, Any]] = Field(default_factory=list)

class SessionApprovalRequest(BaseModel):
    approved: bool
    reason: Optional[str] = None

class FileMetadata(BaseModel):
    fileId: str
    fileName: str
    relativePath: str = ""
    fileSize: int
    mimeType: str = "application/octet-stream"
    sha256Hash: Optional[str] = None
    totalChunks: int
    chunkSize: int

class TransferManifest(BaseModel):
    transferId: str
    senderDeviceId: str
    receiverDeviceId: str
    totalFiles: int
    totalBytes: int
    createdAt: float
    files: List[FileMetadata]

class ChunkUploadHeader(BaseModel):
    transferId: str
    fileId: str
    chunkIndex: int
    offset: int
    size: int
    checksum: str

class ChunkAck(BaseModel):
    transferId: str
    fileId: str
    chunkIndex: int
    status: str  # OK | CORRUPT | MISSING
    message: Optional[str] = None

class ResumeRequest(BaseModel):
    transferId: str
    fileId: str
    knownCompletedChunks: List[int] = Field(default_factory=list)

class ResumeResponse(BaseModel):
    transferId: str
    fileId: str
    completedChunks: List[int]
    missingChunks: List[int]

class TransferHistoryItem(BaseModel):
    id: str
    transferId: str
    timestamp: float
    direction: str  # send | receive
    remoteDeviceName: str
    remotePlatform: str
    transport: str
    fileCount: int
    totalBytes: int
    durationSeconds: float
    avgSpeedBytesPerSec: float
    status: str  # completed | failed | cancelled
    fileNames: List[str]

class NetworkDiagnosticsResponse(BaseModel):
    status: str
    bindHost: str = "0.0.0.0"
    interfaceName: str
    primaryIp: str
    port: int
    portListening: bool
    isReachable: bool = False
    networkType: str
    isHotspot: bool
    statusMessage: str
    protocolVersion: str = "QRDTP/1"
    firewallStatus: str
    lanUrl: str = ""
    healthCheck: Optional[Dict[str, Any]] = None
    troubleshootingTips: List[str] = Field(default_factory=list)
    candidateInterfaces: List[Dict[str, Any]] = Field(default_factory=list)
