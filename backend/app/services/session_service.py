import uuid
import time
import json
from typing import Dict, Optional, Any
from backend.app.core.config import settings
from backend.app.core.state import SessionState, validate_state_transition
from backend.app.security.tokens import token_manager
from backend.app.networking.lan_discovery import build_lan_endpoints
from backend.app.services.qr_service import generate_qr_data_uri
from backend.app.models.schemas import (
    SessionCreateRequest,
    SessionCreateResponse,
    SessionJoinRequest,
    SessionEndpoints,
    QRPairingPayload,
    TransferManifest,
)

class SessionRecord:
    def __init__(
        self,
        session_id: str,
        token: str,
        expires_at: float,
        receiver_device_id: str,
        receiver_device_name: str,
        destination_path: str,
        receiver_platform: str,
        receiver_public_key: str,
        endpoints: SessionEndpoints,
    ):
        self.session_id = session_id
        self.token = token
        self.expires_at = expires_at
        self.receiver_device_id = receiver_device_id
        self.receiver_device_name = receiver_device_name
        self.destination_path = destination_path
        self.receiver_platform = receiver_platform
        self.receiver_public_key = receiver_public_key
        self.endpoints = endpoints
        
        self.state: SessionState = SessionState.QR_GENERATED
        self.created_at = time.time()
        
        # Sender information populated on pair/join
        self.sender_device_id: Optional[str] = None
        self.sender_device_name: Optional[str] = None
        self.sender_platform: Optional[str] = None
        self.sender_public_key: Optional[str] = None
        
        # Transfer manifest
        self.manifest: Optional[TransferManifest] = None
        self.approval_status: Optional[bool] = None

    @property
    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def set_state(self, new_state: SessionState) -> None:
        validate_state_transition(self.state, new_state)
        self.state = new_state

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "state": self.state.value,
            "expiresAt": self.expires_at,
            "receiver": {
                "deviceId": self.receiver_device_id,
                "name": self.receiver_device_name,
                "platform": self.receiver_platform,
                "destinationPath": self.destination_path,
                "publicKey": self.receiver_public_key,
            },
            "sender": {
                "deviceId": self.sender_device_id,
                "name": self.sender_device_name,
                "platform": self.sender_platform,
                "publicKey": self.sender_public_key,
            } if self.sender_device_id else None,
            "endpoints": self.endpoints.model_dump(),
            "manifest": self.manifest.model_dump() if self.manifest else None,
            "approvalStatus": self.approval_status,
        }

class SessionService:
    def __init__(self):
        self._sessions: Dict[str, SessionRecord] = {}

    def cleanup(self) -> None:
        now = time.time()
        expired_ids = [
            sid for sid, s in self._sessions.items()
            if s.is_expired and s.state in {SessionState.CREATED, SessionState.QR_GENERATED, SessionState.WAITING}
        ]
        for sid in expired_ids:
            self._sessions[sid].state = SessionState.EXPIRED
            del self._sessions[sid]

    def create_session(self, req: SessionCreateRequest) -> SessionCreateResponse:
        self.cleanup()
        session_id = str(uuid.uuid4())
        token, expires_at = token_manager.generate_token(session_id, settings.SESSION_TTL_SECONDS)
        
        lan_urls = build_lan_endpoints(settings.PORT)
        relay_url = f"/api/ws/relay/{session_id}"
        endpoints = SessionEndpoints(
            lanUrls=lan_urls,
            relayUrl=relay_url,
            webrtcEnabled=True,
        )

        record = SessionRecord(
            session_id=session_id,
            token=token,
            expires_at=expires_at,
            receiver_device_id=req.receiverDeviceId,
            receiver_device_name=req.receiverDeviceName,
            destination_path=req.destinationPath,
            receiver_platform=req.platform,
            receiver_public_key=req.publicKey,
            endpoints=endpoints,
        )
        self._sessions[session_id] = record

        # Generate canonical QR Payload
        qr_payload_model = QRPairingPayload(
            version="QRDTP/1",
            sessionId=session_id,
            deviceId=req.receiverDeviceId,
            deviceName=req.receiverDeviceName,
            token=token,
            expiresAt=expires_at,
            endpoints=endpoints,
            publicKey=req.publicKey,
        )
        qr_payload_str = json.dumps(qr_payload_model.model_dump(), separators=(',', ':'))
        qr_data_uri = generate_qr_data_uri(qr_payload_str)

        return SessionCreateResponse(
            sessionId=session_id,
            token=token,
            expiresAt=expires_at,
            qrPayload=qr_payload_str,
            qrDataUri=qr_data_uri,
            state=record.state,
            endpoints=endpoints,
        )

    def join_session(self, session_id: str, req: SessionJoinRequest) -> SessionRecord:
        self.cleanup()
        record = self._sessions.get(session_id)
        if not record:
            raise KeyError(f"Session '{session_id}' not found or already closed.")

        if record.is_expired:
            record.state = SessionState.EXPIRED
            raise ValueError("Session pairing QR code has expired.")

        # Replay & Token check
        is_valid = token_manager.validate_and_consume(req.token, session_id)
        if not is_valid:
            raise PermissionError("Invalid or already-consumed pairing token (Replay attack prevention).")

        # Record sender info
        record.sender_device_id = req.senderDeviceId
        record.sender_device_name = req.senderDeviceName
        record.sender_platform = req.platform
        record.sender_public_key = req.publicKey

        # Transition state
        record.set_state(SessionState.PAIRING)
        record.set_state(SessionState.CONNECTED)
        return record

    def get_session(self, session_id: str) -> SessionRecord:
        self.cleanup()
        record = self._sessions.get(session_id)
        if not record:
            raise KeyError(f"Session '{session_id}' not found.")
        return record

    def submit_manifest(self, session_id: str, manifest: TransferManifest) -> None:
        record = self.get_session(session_id)
        record.manifest = manifest
        record.set_state(SessionState.AWAITING_APPROVAL)

    def set_approval(self, session_id: str, approved: bool) -> None:
        record = self.get_session(session_id)
        record.approval_status = approved
        if approved:
            record.set_state(SessionState.APPROVED)
        else:
            record.set_state(SessionState.REJECTED)

    def cancel_session(self, session_id: str) -> None:
        record = self.get_session(session_id)
        record.set_state(SessionState.CANCELLED)

session_service = SessionService()
