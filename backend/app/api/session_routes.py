from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from backend.app.models.schemas import (
    SessionCreateRequest,
    SessionCreateResponse,
    SessionJoinRequest,
    SessionApprovalRequest,
    TransferManifest,
    TransferHistoryItem
)
from backend.app.services.session_service import session_service
from backend.app.services.history_service import history_service
from backend.app.networking.signaling import signaling_manager
from backend.app.core.state import InvalidStateTransitionError

router = APIRouter(prefix="/api/session", tags=["Session"])

@router.post("/create", response_model=SessionCreateResponse)
async def create_session(req: SessionCreateRequest):
    """Initiates a new receiving session with ephemeral token and QR payload."""
    try:
        return session_service.create_session(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/join")
async def join_session(session_id: str, req: SessionJoinRequest):
    """Pairs sender device using scanned QR token. Replay-protected."""
    try:
        record = session_service.join_session(session_id, req)
        # Notify receiver via WebSocket that sender has paired
        await signaling_manager.broadcast_to_session(
            session_id,
            {
                "type": "PAIR_SUCCESS",
                "sender": {
                    "deviceId": req.senderDeviceId,
                    "name": req.senderDeviceName,
                    "platform": req.platform,
                    "publicKey": req.publicKey,
                }
            }
        )
        return record.to_dict()
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (PermissionError, ValueError) as e:
        raise HTTPException(status_code=403, detail=str(e))
    except InvalidStateTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.get("/{session_id}")
async def get_session(session_id: str):
    """Fetches real-time status of session."""
    try:
        record = session_service.get_session(session_id)
        return record.to_dict()
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

@router.post("/{session_id}/manifest")
async def submit_manifest(session_id: str, manifest: TransferManifest):
    """Sender submits transfer manifest. Receiver prompted for approval."""
    try:
        session_service.submit_manifest(session_id, manifest)
        # Signal receiver
        await signaling_manager.broadcast_to_session(
            session_id,
            {
                "type": "TRANSFER_REQUEST",
                "manifest": manifest.model_dump()
            }
        )
        return {"status": "AWAITING_APPROVAL"}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidStateTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.post("/{session_id}/approve")
async def approve_transfer(session_id: str, req: SessionApprovalRequest):
    """Receiver explicitly approves or rejects incoming transfer."""
    try:
        session_service.set_approval(session_id, req.approved)
        msg_type = "TRANSFER_ACCEPT" if req.approved else "TRANSFER_REJECT"
        await signaling_manager.broadcast_to_session(
            session_id,
            {
                "type": msg_type,
                "approved": req.approved,
                "reason": req.reason
            }
        )
        return {"status": "APPROVED" if req.approved else "REJECTED"}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

@router.post("/{session_id}/cancel")
async def cancel_session(session_id: str):
    """Cancels active transfer."""
    try:
        session_service.cancel_session(session_id)
        await signaling_manager.broadcast_to_session(
            session_id,
            {"type": "CANCEL", "message": "Transfer cancelled by peer"}
        )
        return {"status": "CANCELLED"}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

@router.get("/history/list", response_model=List[TransferHistoryItem])
async def get_history(limit: int = 50, query: Optional[str] = Query(None)):
    """Retrieves transfer metadata history."""
    return history_service.list_records(limit=limit, query=query)

@router.post("/history/record")
async def add_history_record(item: TransferHistoryItem):
    """Adds a completed or cancelled transfer record to history."""
    history_service.add_record(item)
    return {"status": "ok"}

@router.delete("/history/clear")
async def clear_history():
    """Clears transfer history."""
    history_service.clear_history()
    return {"status": "cleared"}
