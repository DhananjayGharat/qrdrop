from fastapi import APIRouter, HTTPException, Query, Request
from typing import List, Optional
from backend.app.models.schemas import (
    SessionCreateRequest,
    SessionCreateResponse,
    SessionJoinRequest,
    SessionApprovalRequest,
    DeviceDetectRequest,
    TokenLookupResponse,
    NetworkDiagnosticsResponse,
    TransferManifest,
    TransferHistoryItem
)
from backend.app.services.session_service import session_service
from backend.app.services.history_service import history_service
from backend.app.networking.lan_discovery import get_network_diagnostics
from backend.app.networking.signaling import signaling_manager
from backend.app.networking.turn_service import turn_service
from backend.app.core.config import settings
from backend.app.core.state import InvalidStateTransitionError

router = APIRouter(prefix="/api/session", tags=["Session"])

@router.post("/create", response_model=SessionCreateResponse)
async def create_session(req: SessionCreateRequest, request: Request):
    """Initiates a new receiving session with ephemeral token and real local URL QR payload."""
    try:
        req_port = request.url.port or settings.PORT
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        detected_origin = f"{proto}://{host}" if host else None
        effective_origin = req.clientOrigin or detected_origin
        return session_service.create_session(req, port=req_port, client_origin=effective_origin)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/lookup-token", response_model=TokenLookupResponse)
async def lookup_token(
    request: Request,
    token: str = Query(..., description="Short-lived QR pairing token"),
    device_name: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    browser: Optional[str] = Query(None)
):
    """
    Validates token and returns session information when sender opens the QR URL.
    Also notifies receiver via WebSocket that a new device has been detected.
    """
    try:
        record = session_service.lookup_token(token)

        # Detect sender info from query params or User-Agent
        ua = request.headers.get("user-agent", "")
        detected_browser = browser or ("Safari" if "Safari" in ua and "Chrome" not in ua else "Chrome" if "Chrome" in ua else "Browser")
        detected_platform = platform or ("ios" if "iPhone" in ua or "iPad" in ua else "android" if "Android" in ua else "windows" if "Windows" in ua else "macos" if "Macintosh" in ua else "mobile")
        detected_name = device_name or ("iPhone" if "iPhone" in ua else "Android Device" if "Android" in ua else "Mobile Device")

        session_service.record_device_detected(
            token=token,
            client_platform=detected_platform,
            client_device_name=detected_name,
            browser=detected_browser
        )

        # Signal receiver in real-time
        await signaling_manager.broadcast_to_session(
            record.session_id,
            {
                "type": "DEVICE_DETECTED",
                "device": {
                    "name": detected_name,
                    "platform": detected_platform,
                    "browser": detected_browser,
                }
            }
        )

        net_type = record.network_info.get("network_type", "WI-FI") if record.network_info else "WI-FI"
        is_hotspot = bool(record.network_info.get("is_hotspot", False)) if record.network_info else False
        endpoints = record.endpoints
        ice_servers = endpoints.iceServers if endpoints else []
        lan_urls = endpoints.lanUrls if endpoints else []

        return TokenLookupResponse(
            valid=True,
            sessionId=record.session_id,
            receiverDeviceName=record.receiver_device_name,
            receiverPlatform=record.receiver_platform,
            receiverPublicKey=record.receiver_public_key,
            expiresAt=record.expires_at,
            state=record.state.value,
            protocolVersion="QRDTP/1",
            networkType=net_type,
            isHotspot=is_hotspot,
            lanUrls=lan_urls,
            endpoints=endpoints,
            iceServers=ice_servers,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/device-detect")
async def device_detect(req: DeviceDetectRequest):
    """Sender pings upon opening URL to notify receiver immediately."""
    try:
        record = session_service.record_device_detected(
            token=req.token,
            client_platform=req.clientPlatform,
            client_device_name=req.clientDeviceName,
            browser=req.browser
        )
        await signaling_manager.broadcast_to_session(
            record.session_id,
            {
                "type": "DEVICE_DETECTED",
                "device": {
                    "name": req.clientDeviceName,
                    "platform": req.clientPlatform,
                    "browser": req.browser,
                }
            }
        )
        return {"status": "ok", "sessionId": record.session_id}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

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
                    "browser": req.browser,
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

@router.get("/diagnostics/network", response_model=NetworkDiagnosticsResponse)
async def network_diagnostics(request: Request, selected_ip: Optional[str] = Query(None)):
    """Returns network diagnostics for the Developer Diagnostics panel."""
    req_port = request.url.port or settings.PORT
    return get_network_diagnostics(port=req_port, selected_ip=selected_ip)

@router.get("/{session_id}")
async def get_session(session_id: str):
    """Fetches real-time status of session."""
    try:
        record = session_service.get_session(session_id)
        return record.to_dict()
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

@router.get("/{session_id}/ice-servers")
@router.get("/webrtc/ice-servers/{session_id}")
async def get_ice_servers(session_id: str):
    """Returns dynamic ephemeral STUN/TURN ICE servers for WebRTC negotiation."""
    try:
        session_service.get_session(session_id)
        servers = turn_service.generate_ice_servers(session_id)
        return {"sessionId": session_id, "iceServers": servers}
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
