import uuid
import time
import json
import logging
from typing import Dict, Optional, Any
from backend.app.core.config import settings
from backend.app.core.state import SessionState, validate_state_transition
from backend.app.security.tokens import token_manager
from backend.app.networking.lan_discovery import (
    build_lan_endpoints,
    get_primary_network_info,
    get_primary_lan_ip,
    verify_local_health,
)
from backend.app.core.redis_store import distributed_store
from backend.app.networking.turn_service import turn_service
from backend.app.services.qr_service import generate_qr_data_uri
from backend.app.models.schemas import (
    SessionCreateRequest,
    SessionCreateResponse,
    SessionJoinRequest,
    SessionEndpoints,
    QRPairingPayload,
    TransferManifest,
)

logger = logging.getLogger("qrdrop.session_service")

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
        connect_url: str = "",
        lan_connect_url: str = "",
        global_connect_url: str = "",
        network_info: Optional[Dict[str, Any]] = None,
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
        self.connect_url = connect_url
        self.lan_connect_url = lan_connect_url
        self.global_connect_url = global_connect_url
        self.network_info = network_info or {}
        
        self.state: SessionState = SessionState.QR_GENERATED
        self.created_at = time.time()
        
        # Detected device (when phone scans and opens URL)
        self.detected_device: Optional[Dict[str, Any]] = None

        # Sender information populated on pair/join
        self.sender_device_id: Optional[str] = None
        self.sender_device_name: Optional[str] = None
        self.sender_platform: Optional[str] = None
        self.sender_public_key: Optional[str] = None
        self.sender_browser: Optional[str] = None
        
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
            "token": self.token,
            "state": self.state.value,
            "expiresAt": self.expires_at,
            "connectUrl": self.connect_url,
            "lanConnectUrl": self.lan_connect_url,
            "globalConnectUrl": self.global_connect_url,
            "networkInfo": self.network_info,
            "detectedDevice": self.detected_device,
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
                "browser": self.sender_browser,
            } if self.sender_device_id else None,
            "endpoints": self.endpoints.model_dump() if self.endpoints else None,
            "manifest": self.manifest.model_dump() if self.manifest else None,
            "approvalStatus": self.approval_status,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SessionRecord":
        rec_data = data.get("receiver", {})
        sender_data = data.get("sender") or {}
        endpoints_data = data.get("endpoints")
        endpoints = SessionEndpoints(**endpoints_data) if endpoints_data else SessionEndpoints()
        
        record = cls(
            session_id=data["sessionId"],
            token=data.get("token", ""),
            expires_at=data.get("expiresAt", time.time() + 600),
            receiver_device_id=rec_data.get("deviceId", "receiver"),
            receiver_device_name=rec_data.get("name", "Receiver"),
            destination_path=rec_data.get("destinationPath", ""),
            receiver_platform=rec_data.get("platform", "unknown"),
            receiver_public_key=rec_data.get("publicKey", ""),
            endpoints=endpoints,
            connect_url=data.get("connectUrl", ""),
            lan_connect_url=data.get("lanConnectUrl", ""),
            global_connect_url=data.get("globalConnectUrl", ""),
            network_info=data.get("networkInfo", {}),
        )
        record.state = SessionState(data.get("state", SessionState.QR_GENERATED.value))
        record.detected_device = data.get("detectedDevice")
        if sender_data:
            record.sender_device_id = sender_data.get("deviceId")
            record.sender_device_name = sender_data.get("name")
            record.sender_platform = sender_data.get("platform")
            record.sender_public_key = sender_data.get("publicKey")
            record.sender_browser = sender_data.get("browser")
        if data.get("manifest"):
            record.manifest = TransferManifest(**data["manifest"])
        record.approval_status = data.get("approvalStatus")
        return record

class SessionService:
    def __init__(self):
        self._sessions: Dict[str, SessionRecord] = {}

    def cleanup(self) -> None:
        now = time.time()
        expired_ids = [
            sid for sid, s in self._sessions.items()
            if s.is_expired and s.state in {
                SessionState.CREATED,
                SessionState.QR_GENERATED,
                SessionState.WAITING,
                SessionState.WAITING_FOR_SCAN,
                SessionState.DEVICE_DETECTED
            }
        ]
        for sid in expired_ids:
            self._sessions[sid].state = SessionState.EXPIRED
            del self._sessions[sid]

    def create_session(self, req: SessionCreateRequest, port: Optional[int] = None) -> SessionCreateResponse:
        self.cleanup()
        session_id = str(uuid.uuid4())
        token, expires_at = token_manager.generate_token(session_id, settings.SESSION_TTL_SECONDS)
        
        active_port = port or settings.PORT
        net_info = get_primary_network_info(req.selectedIp)
        primary_ip = net_info["ip"]
        
        # Verify local server reachability before generating QR
        health = verify_local_health(primary_ip, active_port)
        net_info["port"] = active_port
        net_info["bindHost"] = "0.0.0.0"
        net_info["portListening"] = health["serverListening"]
        net_info["isReachable"] = health["reachable"]
        net_info["healthCheck"] = health
        net_info["firewallStatus"] = "ALLOWING_CONNECTIONS" if health["reachable"] else ("CHECK_FIREWALL" if health["serverListening"] else "SERVER_OFFLINE")
        
        if not health["reachable"]:
            logger.warning(
                f"Local reachability probe to http://{primary_ip}:{active_port}/health failed or unconfirmed. "
                f"Detail: {health.get('error')}. Windows Firewall or Wi-Fi isolation may need review."
            )
        
        lan_urls = build_lan_endpoints(active_port)
        relay_url = f"/api/ws/relay/{session_id}"
        signaling_url = f"/ws/signaling/{session_id}"
        
        # Generate ephemeral STUN/TURN credentials for WebRTC fallback
        ice_servers = turn_service.generate_ice_servers(session_id)

        # Connection URLs
        lan_connect_url = f"http://{primary_ip}:{active_port}/connect/{token}"
        if settings.PUBLIC_URL:
            global_connect_url = f"{settings.PUBLIC_URL.rstrip('/')}/connect/{token}"
        else:
            global_connect_url = lan_connect_url

        # Pick primary connect URL for default QR
        if req.preferLocalQr or not settings.PUBLIC_URL:
            chosen_qr_url = lan_connect_url
        else:
            chosen_qr_url = global_connect_url

        endpoints = SessionEndpoints(
            lanUrls=lan_urls,
            relayUrl=relay_url,
            signalingUrl=signaling_url,
            webrtcEnabled=True,
            iceServers=ice_servers,
            publicConnectUrl=global_connect_url if settings.PUBLIC_URL else None,
            lanConnectUrl=lan_connect_url,
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
            connect_url=chosen_qr_url,
            lan_connect_url=lan_connect_url,
            global_connect_url=global_connect_url,
            network_info=net_info,
        )
        self._sessions[session_id] = record

        # Save to distributed store for multi-worker support & token consumption
        try:
            distributed_store.store_token_mapping(token, session_id, ttl=settings.SESSION_TTL_SECONDS)
            distributed_store.set_json(f"session:{session_id}", record.to_dict(), ttl=settings.SESSION_TTL_SECONDS)
        except Exception as e:
            logger.warning(f"Could not persist session to distributed store: {e}")

        # The QR Code encodes the chosen URL for zero-config phone camera scanning
        qr_data_uri = generate_qr_data_uri(chosen_qr_url)

        return SessionCreateResponse(
            sessionId=session_id,
            token=token,
            expiresAt=expires_at,
            qrPayload=chosen_qr_url,
            qrDataUri=qr_data_uri,
            state=record.state,
            endpoints=endpoints,
            connectUrl=chosen_qr_url,
            lanConnectUrl=lan_connect_url,
            globalConnectUrl=global_connect_url,
            networkInfo=net_info,
        )

    def lookup_token(self, token: str) -> SessionRecord:
        """
        Looks up an active session by pairing token without consuming it.
        Used by the sender's browser upon opening the QR URL.
        """
        self.cleanup()
        session_id = token_manager.get_session_for_token(token)
        if not session_id:
            # Check distributed store
            session_id = distributed_store.get_session_by_token(token)

        if not session_id:
            raise KeyError("Invalid, expired, or already-consumed QR connection token.")

        record = self._sessions.get(session_id)
        if not record:
            # Try to restore from distributed store
            session_data = distributed_store.get_json(f"session:{session_id}")
            if session_data:
                record = SessionRecord.from_dict(session_data)
                self._sessions[session_id] = record

        if not record or record.is_expired:
            raise KeyError("Session expired or no longer available.")
            
        return record

    def record_device_detected(
        self,
        token: str,
        client_platform: Optional[str] = None,
        client_device_name: Optional[str] = None,
        browser: Optional[str] = None
    ) -> SessionRecord:
        """
        Marks that a phone/device has opened the connection link.
        """
        record = self.lookup_token(token)
        record.detected_device = {
            "name": client_device_name or "Remote Device",
            "platform": client_platform or "mobile",
            "browser": browser or "Browser",
            "detectedAt": time.time(),
        }
        if record.state in {SessionState.QR_GENERATED, SessionState.WAITING, SessionState.WAITING_FOR_SCAN}:
            try:
                record.set_state(SessionState.DEVICE_DETECTED)
            except Exception:
                pass
        
        # Sync distributed state
        try:
            distributed_store.set_json(f"session:{record.session_id}", record.to_dict(), ttl=settings.SESSION_TTL_SECONDS)
        except Exception:
            pass

        return record

    def join_session(self, session_id: str, req: SessionJoinRequest) -> SessionRecord:
        self.cleanup()
        record = self.get_session(session_id)
        if not record:
            raise KeyError(f"Session '{session_id}' not found or already closed.")

        if record.is_expired:
            record.state = SessionState.EXPIRED
            raise ValueError("Session pairing QR code has expired.")

        # Replay & Token check: consume in both token_manager and distributed_store
        is_valid_local = token_manager.validate_and_consume(req.token, session_id)
        is_valid_dist = distributed_store.consume_token(req.token)
        if not (is_valid_local or is_valid_dist):
            raise PermissionError("Invalid or already-consumed pairing token (Replay attack prevention).")

        # Record sender info
        record.sender_device_id = req.senderDeviceId
        record.sender_device_name = req.senderDeviceName
        record.sender_platform = req.platform
        record.sender_public_key = req.publicKey
        record.sender_browser = req.browser

        # Transition state: PAIRING -> CONNECTED
        record.set_state(SessionState.PAIRING)
        record.set_state(SessionState.CONNECTED)

        # Update distributed store
        try:
            distributed_store.set_json(f"session:{session_id}", record.to_dict(), ttl=settings.SESSION_TTL_SECONDS)
        except Exception:
            pass

        return record

    def get_session(self, session_id: str) -> SessionRecord:
        self.cleanup()
        record = self._sessions.get(session_id)
        if not record:
            session_data = distributed_store.get_json(f"session:{session_id}")
            if session_data:
                record = SessionRecord.from_dict(session_data)
                self._sessions[session_id] = record
            else:
                raise KeyError(f"Session '{session_id}' not found.")
        return record

    def submit_manifest(self, session_id: str, manifest: TransferManifest) -> None:
        record = self.get_session(session_id)
        record.manifest = manifest
        record.set_state(SessionState.AWAITING_APPROVAL)
        
        # Extend session TTL during active transfer
        try:
            distributed_store.extend_ttl(f"session:{session_id}", settings.SESSION_ACTIVE_EXTEND_SECONDS)
            distributed_store.set_json(f"session:{session_id}", record.to_dict(), ttl=settings.SESSION_ACTIVE_EXTEND_SECONDS)
        except Exception:
            pass

    def set_approval(self, session_id: str, approved: bool) -> None:
        record = self.get_session(session_id)
        record.approval_status = approved
        if approved:
            record.set_state(SessionState.APPROVED)
        else:
            record.set_state(SessionState.REJECTED)
            
        try:
            distributed_store.set_json(f"session:{session_id}", record.to_dict(), ttl=settings.SESSION_ACTIVE_EXTEND_SECONDS)
        except Exception:
            pass

    def cancel_session(self, session_id: str) -> None:
        record = self.get_session(session_id)
        record.set_state(SessionState.CANCELLED)
        try:
            distributed_store.set_json(f"session:{session_id}", record.to_dict(), ttl=settings.SESSION_TTL_SECONDS)
        except Exception:
            pass

session_service = SessionService()
