import secrets
import time
from typing import Dict, Set, Optional

class TokenManager:
    """
    Manages temporary pairing tokens for QRDrop sessions.
    Enforces TTL expiration, single-use pairing, and replay protection.
    """
    def __init__(self, default_ttl_seconds: int = 120):
        self.default_ttl = default_ttl_seconds
        # token -> (session_id, expires_at_timestamp)
        self._tokens: Dict[str, tuple[str, float]] = {}
        # Set of consumed/invalidated tokens to block replay attacks
        self._consumed_tokens: Set[str] = set()

    def generate_token(self, session_id: str, ttl_seconds: int | None = None) -> tuple[str, float]:
        """Generates a cryptographically random, single-use token with expiration."""
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        token = secrets.token_urlsafe(32)
        expires_at = time.time() + ttl
        self._tokens[token] = (session_id, expires_at)
        return token, expires_at

    def get_session_for_token(self, token: str) -> Optional[str]:
        """
        Looks up session ID for a valid, non-expired, unconsumed token
        without consuming it.
        """
        self.cleanup_expired()
        if token in self._consumed_tokens:
            return None
        record = self._tokens.get(token)
        if not record:
            return None
        session_id, expires_at = record
        if time.time() > expires_at:
            del self._tokens[token]
            return None
        return session_id

    def validate_and_consume(self, token: str, session_id: str) -> bool:
        """
        Validates token matches session, is not expired, and marks it consumed.
        Guarantees single-use pairing and protects against replay attacks.
        """
        self.cleanup_expired()

        if token in self._consumed_tokens:
            return False  # Replay attack attempt

        record = self._tokens.get(token)
        if not record:
            return False  # Non-existent or expired

        recorded_session_id, expires_at = record
        if recorded_session_id != session_id:
            return False  # Token belongs to another session

        if time.time() > expires_at:
            del self._tokens[token]
            return False  # Expired

        # Consume the token: remove from active tokens, record in consumed set
        del self._tokens[token]
        self._consumed_tokens.add(token)
        return True

    def invalidate(self, token: str) -> None:
        """Explicitly cancels/invalidates a token."""
        if token in self._tokens:
            del self._tokens[token]
        self._consumed_tokens.add(token)

    def cleanup_expired(self) -> None:
        """Purges expired tokens from memory."""
        now = time.time()
        expired = [t for t, (_, exp) in self._tokens.items() if now > exp]
        for t in expired:
            del self._tokens[t]

token_manager = TokenManager()
