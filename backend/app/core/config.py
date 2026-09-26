from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import os
from pathlib import Path

class Settings(BaseSettings):
    APP_ENV: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    
    # 24/7 Public Domain & QR Mode
    PUBLIC_URL: str = ""                       # e.g. "https://qrdrop.app" (empty = auto LAN IP)
    QR_MODE: str = "smart"                     # "smart" | "global" | "local"
    
    # Session & Security (10 minutes TTL while waiting, extended while active)
    SESSION_TTL_SECONDS: int = 600             # 10 minutes default
    SESSION_ACTIVE_EXTEND_SECONDS: int = 3600  # 1 hour extension during active transfer
    TOKEN_ENTROPY_BYTES: int = 32
    MAX_PENDING_SESSIONS: int = 10000
    
    # Chunking & Streaming
    DEFAULT_CHUNK_SIZE: int = 256 * 1024       # 256 KB
    MAX_CHUNK_SIZE: int = 1024 * 1024          # 1 MB
    MIN_CHUNK_SIZE: int = 64 * 1024            # 64 KB
    MAX_FILE_SIZE_BYTES: int = 100 * 1024**3   # 100 GB limit
    MAX_PARALLEL_CHUNKS: int = 4
    
    # Redis Session & PubSub Coordination
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_ENABLED: bool = True
    REDIS_CONNECT_TIMEOUT: float = 1.0
    
    # WebRTC STUN/TURN servers & Ephemeral Credentials (RFC 5766)
    STUN_SERVERS: str = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478"
    TURN_SERVERS: str = "turn:turn.qrdrop.app:3478?transport=udp,turn:turn.qrdrop.app:3478?transport=tcp"
    TURN_SECRET: str = "qrdrop-production-turn-secret-key-2026"
    TURN_TTL_SECONDS: int = 3600               # 1 hour credential TTL
    
    # Storage & History
    DEFAULT_DOWNLOAD_DIR: str = str(Path.home() / "Downloads" / "QRDrop")
    DATABASE_PATH: str = "qrdrop.db"

    @property
    def stun_server_list(self) -> List[str]:
        return [s.strip() for s in self.STUN_SERVERS.split(",") if s.strip()]

    @property
    def turn_server_list(self) -> List[str]:
        return [s.strip() for s in self.TURN_SERVERS.split(",") if s.strip()]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
