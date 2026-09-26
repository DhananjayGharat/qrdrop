from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import os
from pathlib import Path

class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    
    # Session & Security
    SESSION_TTL_SECONDS: int = 120
    TOKEN_ENTROPY_BYTES: int = 32
    MAX_PENDING_SESSIONS: int = 1000
    
    # Chunking & Streaming
    DEFAULT_CHUNK_SIZE: int = 256 * 1024       # 256 KB
    MAX_CHUNK_SIZE: int = 1024 * 1024          # 1 MB
    MIN_CHUNK_SIZE: int = 64 * 1024            # 64 KB
    MAX_FILE_SIZE_BYTES: int = 100 * 1024**3   # 100 GB limit
    MAX_PARALLEL_CHUNKS: int = 4
    
    # WebRTC STUN/TURN servers
    STUN_SERVERS: str = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    
    # Storage & History
    DEFAULT_DOWNLOAD_DIR: str = str(Path.home() / "Downloads" / "QRDrop")
    DATABASE_PATH: str = "qrdrop.db"

    @property
    def stun_server_list(self) -> List[str]:
        return [s.strip() for s in self.STUN_SERVERS.split(",") if s.strip()]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
