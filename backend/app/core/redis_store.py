"""
QRDrop Distributed State & Redis Coordination Store
Provides multi-worker session state, token mapping, atomic replay prevention,
and Redis Pub/Sub for WebRTC signaling across load-balanced API nodes.
Seamlessly falls back to in-memory store when Redis is unavailable.
"""

import json
import time
import logging
import asyncio
from typing import Dict, Any, Optional, Set, Callable, Awaitable
from backend.app.core.config import settings

logger = logging.getLogger("qrdrop.redis_store")

try:
    import redis
    import redis.asyncio as aioredis
except ImportError:
    redis = None
    aioredis = None

class DistributedStore:
    def __init__(self):
        self._sync_client = None
        self._async_client = None
        self._is_connected = False
        self._tested_connection = False
        
        # Local in-memory fallback stores
        self._mem_store: Dict[str, Any] = {}
        self._mem_expirations: Dict[str, float] = {}
        self._subscribers: Dict[str, Set[Callable[[Dict[str, Any]], Awaitable[None]]]] = {}

    def _get_sync_client(self):
        if not settings.REDIS_ENABLED or not redis:
            return None
        if self._sync_client is not None:
            return self._sync_client
        # Avoid blocking repeatedly if Redis connection failed recently
        if getattr(self, "_connect_failed", False):
            if time.time() - getattr(self, "_last_attempt_time", 0) < 30.0:
                return None
        try:
            self._last_attempt_time = time.time()
            self._sync_client = redis.from_url(
                settings.REDIS_URL,
                socket_connect_timeout=settings.REDIS_CONNECT_TIMEOUT,
                decode_responses=True
            )
            self._sync_client.ping()
            self._is_connected = True
            self._connect_failed = False
            logger.info(f"Connected to Redis at {settings.REDIS_URL}")
            return self._sync_client
        except Exception as e:
            logger.warning(f"Redis not available ({e}). Using in-memory distributed store fallback.")
            self._sync_client = None
            self._is_connected = False
            self._connect_failed = True
            return None

    async def get_async_client(self):
        if not settings.REDIS_ENABLED or not aioredis:
            return None
        if self._async_client is not None:
            return self._async_client
        if getattr(self, "_async_connect_failed", False):
            if time.time() - getattr(self, "_last_async_attempt_time", 0) < 30.0:
                return None
        try:
            self._last_async_attempt_time = time.time()
            client = aioredis.from_url(
                settings.REDIS_URL,
                socket_connect_timeout=settings.REDIS_CONNECT_TIMEOUT,
                decode_responses=True
            )
            await client.ping()
            self._async_client = client
            self._is_connected = True
            self._async_connect_failed = False
            return self._async_client
        except Exception as e:
            logger.debug(f"Async Redis not reachable ({e}). Using fallback.")
            self._async_client = None
            self._is_connected = False
            self._async_connect_failed = True
            return None

    @property
    def is_redis_active(self) -> bool:
        if not self._tested_connection:
            client = self._get_sync_client()
            self._tested_connection = True
            return client is not None
        return self._is_connected

    # ==========================================
    # KEY-VALUE / JSON STORAGE METHODS
    # ==========================================

    def set_json(self, key: str, value: Any, ex_seconds: Optional[int] = None, ttl: Optional[int] = None) -> bool:
        """Stores a JSON-serializable value with optional TTL."""
        seconds = ttl if ttl is not None else ex_seconds
        client = self._get_sync_client()
        serialized = json.dumps(value)
        if client:
            try:
                if seconds:
                    client.setex(key, seconds, serialized)
                else:
                    client.set(key, serialized)
                return True
            except Exception as e:
                logger.warning(f"Redis set_json failed ({e}), writing to memory fallback")
        
        # In-memory fallback
        self._mem_store[key] = serialized
        if seconds:
            self._mem_expirations[key] = time.time() + seconds
        elif key in self._mem_expirations:
            del self._mem_expirations[key]
        return True

    def get_json(self, key: str) -> Optional[Any]:
        """Retrieves and deserializes a JSON value."""
        client = self._get_sync_client()
        if client:
            try:
                raw = client.get(key)
                if raw:
                    return json.loads(raw)
                return None
            except Exception as e:
                logger.warning(f"Redis get_json failed ({e}), checking memory fallback")

        # In-memory fallback
        if key in self._mem_expirations and time.time() > self._mem_expirations[key]:
            del self._mem_store[key]
            del self._mem_expirations[key]
            return None

        raw = self._mem_store.get(key)
        return json.loads(raw) if raw else None

    def delete(self, key: str) -> bool:
        """Removes a key from store."""
        client = self._get_sync_client()
        if client:
            try:
                client.delete(key)
            except Exception:
                pass
        self._mem_store.pop(key, None)
        self._mem_expirations.pop(key, None)
        return True

    def expire(self, key: str, seconds: int) -> bool:
        """Sets or extends the TTL of an active key."""
        client = self._get_sync_client()
        if client:
            try:
                return bool(client.expire(key, seconds))
            except Exception:
                pass
        if key in self._mem_store:
            self._mem_expirations[key] = time.time() + seconds
            return True
        return False

    def extend_ttl(self, key: str, seconds: int) -> bool:
        """Alias for expire to extend active key TTL."""
        return self.expire(key, seconds)

    # ==========================================
    # SESSION & TOKEN HELPERS
    # ==========================================

    def store_token_mapping(self, token: str, session_id: str, ttl_seconds: int = 600, ttl: Optional[int] = None) -> bool:
        """Stores short-lived pairing token mapping."""
        sec = ttl if ttl is not None else ttl_seconds
        key = f"token:{token}"
        return self.set_json(key, {"sessionId": session_id, "createdAt": time.time()}, ex_seconds=sec)

    def get_token_session_id(self, token: str) -> Optional[str]:
        """Looks up session ID for token without consuming it."""
        key = f"token:{token}"
        data = self.get_json(key)
        return data["sessionId"] if data else None

    def get_session_by_token(self, token: str) -> Optional[str]:
        """Alias for get_token_session_id."""
        return self.get_token_session_id(token)

    def consume_token(self, token: str) -> Optional[str]:
        """
        Atomically validates and consumes token (single-use replay prevention).
        Returns sessionId if valid, None if invalid or already used.
        """
        key = f"token:{token}"
        client = self._get_sync_client()
        if client:
            try:
                # Redis pipeline for atomic get and delete
                pipe = client.pipeline()
                pipe.get(key)
                pipe.delete(key)
                results = pipe.execute()
                raw_val = results[0]
                if raw_val:
                    data = json.loads(raw_val)
                    return data.get("sessionId")
                return None
            except Exception as e:
                logger.warning(f"Redis atomic consume_token failed: {e}")

        # In-memory atomic fallback
        session_id = self.get_token_session_id(token)
        if session_id:
            self.delete(key)
            return session_id
        return None

    # ==========================================
    # WEBRTC SIGNALING PUB/SUB FOR MULTI-WORKER NODES
    # ==========================================

    async def publish_signal(self, session_id: str, message: Dict[str, Any]) -> None:
        """Publishes WebRTC signaling message to Redis channel for multi-worker delivery."""
        channel = f"signals:{session_id}"
        payload_str = json.dumps(message)
        client = await self.get_async_client()
        if client:
            try:
                await client.publish(channel, payload_str)
                return
            except Exception as e:
                logger.warning(f"Redis publish_signal failed: {e}")

        # Local in-memory pubsub dispatch
        if channel in self._subscribers:
            for cb in list(self._subscribers[channel]):
                try:
                    await cb(message)
                except Exception as cb_err:
                    logger.warning(f"Local subscriber callback error: {cb_err}")

    def register_local_subscriber(
        self,
        session_id: str,
        callback: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> None:
        """Registers a local WebSocket listener for session signaling."""
        channel = f"signals:{session_id}"
        if channel not in self._subscribers:
            self._subscribers[channel] = set()
        self._subscribers[channel].add(callback)

    def unregister_local_subscriber(
        self,
        session_id: str,
        callback: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> None:
        """Unregisters a local WebSocket listener."""
        channel = f"signals:{session_id}"
        if channel in self._subscribers:
            self._subscribers[channel].discard(callback)
            if not self._subscribers[channel]:
                del self._subscribers[channel]

distributed_store = DistributedStore()
