import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from backend.app.networking.signaling import signaling_manager

logger = logging.getLogger("qrdrop.websocket")
router = APIRouter(prefix="/api/ws", tags=["WebSocket"])

@router.websocket("/signal/{session_id}")
async def websocket_signaling_endpoint(
    websocket: WebSocket,
    session_id: str,
    role: str = Query(..., description="'receiver' or 'sender'")
):
    """
    WebSocket endpoint for real-time peer signaling, WebRTC negotiation, and control events.
    """
    await signaling_manager.connect(websocket, session_id, role)
    try:
        # Notify the other peer that this role joined
        await signaling_manager.broadcast_to_session(
            session_id,
            {"type": "PEER_CONNECTED", "role": role},
            sender_socket=websocket
        )

        while True:
            text_data = await websocket.receive_text()
            try:
                msg = json.loads(text_data)
                # Forward to peer
                await signaling_manager.broadcast_to_session(
                    session_id,
                    msg,
                    sender_socket=websocket
                )
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON received on signaling {session_id}")
    except WebSocketDisconnect:
        signaling_manager.disconnect(websocket, session_id, role)
        await signaling_manager.broadcast_to_session(
            session_id,
            {"type": "PEER_DISCONNECTED", "role": role}
        )
    except Exception as e:
        logger.error(f"Signaling error for {session_id}: {e}")
        signaling_manager.disconnect(websocket, session_id, role)

@router.websocket("/relay/{session_id}")
async def websocket_relay_endpoint(
    websocket: WebSocket,
    session_id: str,
    role: str = Query(..., description="'receiver' or 'sender'")
):
    """
    WebSocket endpoint for Secure Relay fallback.
    Streams end-to-end encrypted binary chunks directly between peers.
    """
    await signaling_manager.connect(websocket, session_id, role)
    try:
        while True:
            # Receive either binary chunk or text control frame
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                await signaling_manager.relay_binary(
                    session_id,
                    message["bytes"],
                    sender_socket=websocket
                )
            elif "text" in message and message["text"]:
                try:
                    parsed = json.loads(message["text"])
                    await signaling_manager.broadcast_to_session(
                        session_id,
                        parsed,
                        sender_socket=websocket
                    )
                except Exception:
                    pass
    except WebSocketDisconnect:
        signaling_manager.disconnect(websocket, session_id, role)
    except Exception as e:
        logger.error(f"Relay error for {session_id}: {e}")
        signaling_manager.disconnect(websocket, session_id, role)
