from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header
from fastapi.responses import FileResponse
from typing import Optional, List, Dict, Tuple
from pathlib import Path
from pydantic import BaseModel
from backend.app.models.schemas import FileMetadata, ChunkAck, ResumeResponse
from backend.app.services.session_service import session_service
from backend.app.transfer.chunk_engine import transfer_engine, FileIntegrityError
from backend.app.security.sanitizer import PathTraversalError

router = APIRouter(prefix="/api/transfer", tags=["Transfer"])

# Track finalized files available for browser download: "transfer_id:file_id" -> (final_path, filename)
_completed_files: Dict[str, Tuple[Path, str]] = {}

class RegisterFileRequest(BaseModel):
    sessionId: str
    transferId: str
    fileMetadata: FileMetadata
    conflictMode: str = "keep_both"  # keep_both | replace | skip

class FinalizeFileRequest(BaseModel):
    transferId: str
    fileId: str

@router.post("/register-file")
async def register_file(req: RegisterFileRequest):
    """Registers an incoming file transfer and sets up destination directories."""
    try:
        session = session_service.get_session(req.sessionId)
        dest_dir = session.destination_path
        active_transfer = transfer_engine.register_file(
            transfer_id=req.transferId,
            file_meta=req.fileMetadata,
            destination_dir=dest_dir,
            conflict_mode=req.conflictMode
        )
        return {
            "status": "ready",
            "destinationPath": str(active_transfer.final_path),
            "completedChunks": list(active_transfer.completed_chunks),
            "missingChunks": active_transfer.get_missing_chunks()
        }
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=f"Path traversal blocked: {str(e)}")
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload-chunk", response_model=ChunkAck)
async def upload_chunk(
    transferId: str = Form(...),
    fileId: str = Form(...),
    chunkIndex: int = Form(...),
    offset: int = Form(...),
    checksum: Optional[str] = Form(None),
    chunkFile: UploadFile = File(...)
):
    """
    Direct LAN / HTTP chunk upload.
    Writes chunk directly to disk at designated offset without loading entire file into RAM.
    """
    active_transfer = transfer_engine.get_file_transfer(transferId, fileId)
    if not active_transfer:
        raise HTTPException(status_code=404, detail="File transfer not registered or expired.")

    chunk_bytes = await chunkFile.read()
    ack = await active_transfer.write_chunk(
        chunk_index=chunkIndex,
        offset=offset,
        chunk_data=chunk_bytes,
        expected_checksum=checksum
    )
    return ack

@router.get("/resume-status/{transfer_id}/{file_id}", response_model=ResumeResponse)
async def get_resume_status(transfer_id: str, file_id: str):
    """Returns completed and missing chunk indices for resumable transfer."""
    active_transfer = transfer_engine.get_file_transfer(transfer_id, file_id)
    if not active_transfer:
        raise HTTPException(status_code=404, detail="Active transfer not found")
        
    return ResumeResponse(
        transferId=transfer_id,
        fileId=file_id,
        completedChunks=sorted(list(active_transfer.completed_chunks)),
        missingChunks=sorted(active_transfer.get_missing_chunks())
    )

@router.post("/finalize-file")
async def finalize_file(req: FinalizeFileRequest):
    """
    Verifies full file SHA-256 against manifest and atomically commits the file.
    """
    active_transfer = transfer_engine.get_file_transfer(req.transferId, req.fileId)
    if not active_transfer:
        raise HTTPException(status_code=404, detail="Active transfer not found")

    try:
        verified_hash = await active_transfer.finalize_file()
        final_path = active_transfer.final_path
        file_name = active_transfer.meta.fileName
        _completed_files[f"{req.transferId}:{req.fileId}"] = (final_path, file_name)
        # Clean up memory record for active chunk writing
        transfer_engine.remove_file_transfer(req.transferId, req.fileId)
        return {
            "status": "VERIFIED",
            "fileId": req.fileId,
            "finalPath": str(final_path),
            "sha256": verified_hash,
            "downloadUrl": f"/api/transfer/download/{req.transferId}/{req.fileId}"
        }
    except FileIntegrityError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download/{transfer_id}/{file_id}")
async def download_file(transfer_id: str, file_id: str):
    """
    Allows the receiver browser to download the completed file to their local machine.
    """
    key = f"{transfer_id}:{file_id}"
    entry = _completed_files.get(key)
    if not entry:
        raise HTTPException(status_code=404, detail="File not found or transfer expired")
    file_path, file_name = entry
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File no longer exists on server")
    return FileResponse(
        path=str(file_path),
        filename=file_name,
        media_type="application/octet-stream"
    )
