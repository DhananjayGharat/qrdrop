"""
QRDrop Ephemeral TURN & STUN Credential Provider (RFC 5766 REST API)
Generates secure short-lived TURN credentials using HMAC-SHA1 authentication.
Never exposes static credentials to web clients.
"""

import time
import hmac
import hashlib
import base64
import logging
from typing import List, Dict, Any, Optional
from backend.app.core.config import settings

logger = logging.getLogger("qrdrop.turn_service")

class TurnCredentialService:
    def __init__(self):
        self.secret = settings.TURN_SECRET
        self.ttl = settings.TURN_TTL_SECONDS

    def generate_ice_servers(self, session_id: str, client_ip: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Returns list of STUN and ephemeral TURN server configurations
        for RTCPeerConnection initialization.
        """
        ice_servers: List[Dict[str, Any]] = []

        # 1. Public STUN servers (always provided for direct NAT discovery)
        stun_urls = settings.stun_server_list
        if stun_urls:
            ice_servers.append({
                "urls": stun_urls
            })

        # 2. Ephemeral TURN server credentials (RFC 5766)
        turn_urls = settings.turn_server_list
        if turn_urls and self.secret:
            timestamp = int(time.time()) + self.ttl
            # Standard RFC 5766 username format: <expiry_timestamp>:<identity>
            username = f"{timestamp}:{session_id}"
            
            # Compute HMAC-SHA1 digest
            hmac_digest = hmac.new(
                self.secret.encode("utf-8"),
                username.encode("utf-8"),
                hashlib.sha1
            ).digest()
            password = base64.b64encode(hmac_digest).decode("utf-8")

            ice_servers.append({
                "urls": turn_urls,
                "username": username,
                "credential": password
            })

        return ice_servers

    def get_public_ice_configuration(self, session_id: str) -> Dict[str, Any]:
        """Provides full WebRTC configuration dictionary ready for client-side consumption."""
        return {
            "iceServers": self.generate_ice_servers(session_id),
            "iceTransportPolicy": "all",  # Allows both direct and relay candidates
            "iceCandidatePoolSize": 10,
            "bundlePolicy": "max-bundle",
            "rtcpMuxPolicy": "require"
        }

turn_service = TurnCredentialService()
