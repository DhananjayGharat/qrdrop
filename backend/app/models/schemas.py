from pydantic import BaseModel, Field
from typing import List, Optional
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
    appVersion: str = "1.0.0"
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)

class SessionEndpoints(BaseModel):
    lanUrls: List[str] = Field(default_factory=list)
    relayUrl: str = ""
    webrtcEnabled: bool = True

class QRPairingPayload(BaseModel):
    version: str = "QRDTP/1"
    sessionId: str
    deviceId: str
    deviceName: str
    token: str
    expiresAt: float
    endpoints: SessionEndpoints
    publicKey: str

class SessionCreateRequest(BaseModel):
    receiverDeviceId: str
    receiverDeviceName: str
    destinationPath: str
    platform: str
    publicKey: str

class SessionCreateResponse(BaseModel):
    sessionId: str
    token: str
    expiresAt: float
    qrPayload: str
    qrDataUri: str
    state: SessionState
    endpoints: SessionEndpoints

class SessionJoinRequest(BaseModel):
    token: str
    senderDeviceId: str
    senderDeviceName: str
    platform: str
    publicKey: str

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
