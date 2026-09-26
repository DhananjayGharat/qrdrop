import os
import json
import asyncio
from pathlib import Path
from typing import Dict, Set, Optional, Tuple, List
from backend.app.security.sanitizer import (
    resolve_safe_destination_path,
    resolve_safe_conflict_name,
    PathTraversalError
)
from backend.app.security.crypto import (
    calculate_sha256_file,
    calculate_sha256_bytes,
    decrypt_chunk
)
from backend.app.models.schemas import FileMetadata, ChunkAck

class ChunkIntegrityError(ValueError):
    """Raised when a chunk's checksum doesn't match the expected hash."""
    pass

class FileIntegrityError(ValueError):
    """Raised when the assembled file's SHA-256 does not match the sender's manifest hash."""
    pass

class ActiveFileTransfer:
    def __init__(
        self,
        transfer_id: str,
        file_meta: FileMetadata,
        destination_dir: str,
        conflict_mode: str = "keep_both",
        encryption_key: Optional[bytes] = None
    ):
        self.transfer_id = transfer_id
        self.meta = file_meta
        self.destination_dir = destination_dir
        self.conflict_mode = conflict_mode
        self.encryption_key = encryption_key

        # Resolve target path safely
        self.final_path = resolve_safe_conflict_name(
            destination_dir,
            file_meta.relativePath,
            file_meta.fileName,
            conflict_mode
        )
        self.partial_path = Path(str(self.final_path) + ".qrdrop.partial")
        self.meta_path = Path(str(self.final_path) + ".qrdrop.meta")

        # Track received chunks
        self.completed_chunks: Set[int] = set()
        self.total_chunks = file_meta.totalChunks
        self.chunk_size = file_meta.chunkSize
        self.file_size = file_meta.fileSize

        self._lock = asyncio.Lock()
        self._load_existing_state()

    def _load_existing_state(self) -> None:
        """Loads existing partial transfer progress if resuming."""
        if self.meta_path.exists() and self.partial_path.exists():
            try:
                with open(self.meta_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("fileId") == self.meta.fileId and data.get("fileSize") == self.file_size:
                        self.completed_chunks = set(data.get("completedChunks", []))
            except Exception:
                self.completed_chunks = set()

    def _save_state(self) -> None:
        """Persists current chunk state for crash recovery and resume."""
        try:
            self.partial_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.meta_path, "w", encoding="utf-8") as f:
                json.dump({
                    "transferId": self.transfer_id,
                    "fileId": self.meta.fileId,
                    "fileName": self.meta.fileName,
                    "fileSize": self.file_size,
                    "totalChunks": self.total_chunks,
                    "completedChunks": list(self.completed_chunks),
                }, f)
        except Exception:
            pass

    async def write_chunk(
        self,
        chunk_index: int,
        offset: int,
        chunk_data: bytes,
        expected_checksum: Optional[str] = None
    ) -> ChunkAck:
        async with self._lock:
            # 1. Decrypt if an encryption key is configured
            if self.encryption_key:
                try:
                    payload = decrypt_chunk(self.encryption_key, chunk_data)
                except Exception as e:
                    return ChunkAck(
                        transferId=self.transfer_id,
                        fileId=self.meta.fileId,
                        chunkIndex=chunk_index,
                        status="CORRUPT",
                        message=f"Decryption failed: {str(e)}"
                    )
            else:
                payload = chunk_data

            # 2. Verify chunk checksum (if provided)
            if expected_checksum:
                actual_checksum = calculate_sha256_bytes(payload)
                if actual_checksum.lower() != expected_checksum.lower():
                    return ChunkAck(
                        transferId=self.transfer_id,
                        fileId=self.meta.fileId,
                        chunkIndex=chunk_index,
                        status="CORRUPT",
                        message="Chunk hash mismatch"
                    )

            # 3. Ensure parent directories exist
            self.partial_path.parent.mkdir(parents=True, exist_ok=True)

            # 4. Open partial file in r+b or w+b mode and write at exact offset
            # (Allows out-of-order chunk writes!)
            mode = "r+b" if self.partial_path.exists() else "w+b"
            with open(self.partial_path, mode) as f:
                f.seek(offset)
                f.write(payload)

            self.completed_chunks.add(chunk_index)
            self._save_state()

            return ChunkAck(
                transferId=self.transfer_id,
                fileId=self.meta.fileId,
                chunkIndex=chunk_index,
                status="OK"
            )

    def is_all_chunks_received(self) -> bool:
        return len(self.completed_chunks) >= self.total_chunks

    def get_missing_chunks(self) -> List[int]:
        return [i for i in range(self.total_chunks) if i not in self.completed_chunks]

    async def finalize_file(self) -> str:
        """
        Validates all chunks, computes full SHA-256 of the partial file,
        compares with sender manifest hash, and atomically commits the file.
        """
        async with self._lock:
            if not self.is_all_chunks_received():
                missing = self.get_missing_chunks()
                raise FileIntegrityError(f"Cannot finalize: missing chunks {missing[:5]}...")

            if not self.partial_path.exists():
                raise FileNotFoundError("Partial file does not exist")

            # Streaming SHA-256 calculation
            computed_sha = calculate_sha256_file(str(self.partial_path))

            if self.meta.sha256Hash:
                if computed_sha.lower() != self.meta.sha256Hash.lower():
                    raise FileIntegrityError(
                        f"Integrity check failed! Expected {self.meta.sha256Hash}, computed {computed_sha}"
                    )

            # Atomic rename / commit
            if self.final_path.exists():
                if self.conflict_mode == "replace":
                    os.replace(self.partial_path, self.final_path)
                else:
                    self.final_path = resolve_safe_conflict_name(
                        self.destination_dir,
                        self.meta.relativePath,
                        self.meta.fileName,
                        self.conflict_mode
                    )
                    os.replace(self.partial_path, self.final_path)
            else:
                os.replace(self.partial_path, self.final_path)

            # Remove meta file
            if self.meta_path.exists():
                try:
                    self.meta_path.unlink()
                except Exception:
                    pass

            return computed_sha

class TransferEngine:
    """Coordinates multiple active file transfers and resume tracking."""
    def __init__(self):
        # (transfer_id, file_id) -> ActiveFileTransfer
        self._active_files: Dict[Tuple[str, str], ActiveFileTransfer] = {}

    def register_file(
        self,
        transfer_id: str,
        file_meta: FileMetadata,
        destination_dir: str,
        conflict_mode: str = "keep_both",
        encryption_key: Optional[bytes] = None
    ) -> ActiveFileTransfer:
        key = (transfer_id, file_meta.fileId)
        if key not in self._active_files:
            self._active_files[key] = ActiveFileTransfer(
                transfer_id=transfer_id,
                file_meta=file_meta,
                destination_dir=destination_dir,
                conflict_mode=conflict_mode,
                encryption_key=encryption_key
            )
        return self._active_files[key]

    def get_file_transfer(self, transfer_id: str, file_id: str) -> Optional[ActiveFileTransfer]:
        return self._active_files.get((transfer_id, file_id))

    def remove_file_transfer(self, transfer_id: str, file_id: str) -> None:
        self._active_files.pop((transfer_id, file_id), None)

transfer_engine = TransferEngine()
