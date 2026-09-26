import json
import logging
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger("qrdrop.signaling")

class ConnectionManager:
    def __init__(self):
        # session_id -> Set[WebSocket]
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # session_id -> { "receiver": ws, "sender": ws }
        self.role_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_id: str, role: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = set()
            self.role_connections[session_id] = {}
        
        self.active_connections[session_id].add(websocket)
        self.role_connections[session_id][role] = websocket
        logger.info(f"WebSocket connected for session {session_id}, role: {role}")

    def disconnect(self, websocket: WebSocket, session_id: str, role: str):
        if session_id in self.active_connections:
            self.active_connections[session_id].discard(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
        
        if session_id in self.role_connections:
            if self.role_connections[session_id].get(role) == websocket:
                del self.role_connections[session_id][role]
            if not self.role_connections[session_id]:
                del self.role_connections[session_id]
        logger.info(f"WebSocket disconnected for session {session_id}, role: {role}")

    async def broadcast_to_session(self, session_id: str, message: dict, sender_socket: WebSocket | None = None):
        """Sends JSON message to other peer in the session."""
        if session_id in self.active_connections:
            msg_str = json.dumps(message)
            for connection in list(self.active_connections[session_id]):
                if connection != sender_socket:
                    try:
                        await connection.send_text(msg_str)
                    except Exception as e:
                        logger.warning(f"Error broadcasting to socket in {session_id}: {e}")

    async def send_to_role(self, session_id: str, target_role: str, message: dict):
        """Sends JSON message specifically to 'receiver' or 'sender'."""
        if session_id in self.role_connections:
            target_ws = self.role_connections[session_id].get(target_role)
            if target_ws:
                try:
                    await target_ws.send_text(json.dumps(message))
                except Exception as e:
                    logger.warning(f"Error sending to {target_role} in {session_id}: {e}")

    async def relay_binary(self, session_id: str, data: bytes, sender_socket: WebSocket):
        """Relays encrypted binary chunk bytes directly to the other peer."""
        if session_id in self.active_connections:
            for connection in list(self.active_connections[session_id]):
                if connection != sender_socket:
                    try:
                        await connection.send_bytes(data)
                    except Exception as e:
                        logger.warning(f"Error relaying bytes in {session_id}: {e}")

signaling_manager = ConnectionManager()
