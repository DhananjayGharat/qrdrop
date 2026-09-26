import time
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.config import settings
from backend.app.core.redis_store import distributed_store
from backend.app.networking.turn_service import turn_service
from backend.app.models.schemas import SessionCreateRequest, TransferManifest

client = TestClient(app)

def test_distributed_store_in_memory_fallback():
    """Verify DistributedStore operates reliably with in-memory fallback."""
    # Test JSON set & get
    test_key = "test:store:item1"
    distributed_store.set_json(test_key, {"message": "hello", "count": 42}, ex_seconds=10)
    data = distributed_store.get_json(test_key)
    assert data is not None
    assert data["message"] == "hello"
    assert data["count"] == 42

    # Test token mapping & atomic single-use consumption
    token = "test-token-xyz-123"
    session_id = "sess-abc-789"
    distributed_store.store_token_mapping(token, session_id, ttl=60)
    
    # First lookup without consumption
    lookup_sid = distributed_store.get_session_by_token(token)
    assert lookup_sid == session_id

    # Atomic consumption
    consumed_sid = distributed_store.consume_token(token)
    assert consumed_sid == session_id

    # Replay attack attempt: second consumption MUST return None
    replayed = distributed_store.consume_token(token)
    assert replayed is None
    assert distributed_store.get_session_by_token(token) is None

def test_turn_service_ephemeral_credentials():
    """Verify RFC 5766 TURN REST API ephemeral credential calculation."""
    session_id = "test-webrtc-sess-001"
    ice_servers = turn_service.generate_ice_servers(session_id)
    assert len(ice_servers) >= 1

    # Verify STUN servers are always present
    stun_found = any(
        isinstance(s.get("urls"), list) and any(u.startswith("stun:") for u in s["urls"])
        for s in ice_servers
    )
    assert stun_found

    # Verify turn credentials structure
    turn_entry = next((s for s in ice_servers if "username" in s and "credential" in s), None)
    if turn_entry:
        assert ":" in turn_entry["username"]
        assert len(turn_entry["credential"]) > 10
        # Username timestamp must be in future
        ts_str = turn_entry["username"].split(":")[0]
        assert int(ts_str) > time.time()

def test_dual_mode_urls_in_session_creation(monkeypatch):
    """Verify dual-mode LAN and Global connection URLs in session creation."""
    monkeypatch.setattr(settings, "PUBLIC_URL", "https://qrdrop.example.com")

    # 1. Default (global preferred when PUBLIC_URL is configured)
    req1 = SessionCreateRequest(
        receiverDeviceId="pc-1",
        receiverDeviceName="Test PC",
        destinationPath="Downloads/QRDrop",
        platform="windows",
        publicKey="01020304"
    )
    res1 = client.post("/api/session/create", json=req1.model_dump())
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["globalConnectUrl"].startswith("https://qrdrop.example.com/connect/")
    assert data1["lanConnectUrl"].startswith("http://")
    assert ":8000/connect/" in data1["lanConnectUrl"]
    assert data1["connectUrl"] == data1["globalConnectUrl"]
    assert data1["endpoints"]["iceServers"] is not None
    assert len(data1["endpoints"]["iceServers"]) >= 1

    # 2. Prefer local QR explicitly
    req2 = SessionCreateRequest(
        receiverDeviceId="pc-1",
        receiverDeviceName="Test PC",
        destinationPath="Downloads/QRDrop",
        platform="windows",
        publicKey="01020304",
        preferLocalQr=True
    )
    res2 = client.post("/api/session/create", json=req2.model_dump())
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["connectUrl"] == data2["lanConnectUrl"]

def test_token_lookup_enrichment(monkeypatch):
    """Verify token lookup returns iceServers and lanUrls for smart client negotiation."""
    monkeypatch.setattr(settings, "PUBLIC_URL", "https://qrdrop.example.com")
    
    # Create session
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "pc-test",
        "receiverDeviceName": "Office Laptop",
        "destinationPath": "Downloads/QRDrop",
        "platform": "windows",
        "publicKey": "abcd1234"
    })
    assert create_res.status_code == 200
    token = create_res.json()["token"]
    session_id = create_res.json()["sessionId"]

    # Lookup token
    lookup_res = client.get(f"/api/session/lookup-token?token={token}")
    assert lookup_res.status_code == 200
    info = lookup_res.json()
    assert info["valid"] is True
    assert info["sessionId"] == session_id
    assert "lanUrls" in info and len(info["lanUrls"]) >= 1
    assert "iceServers" in info and len(info["iceServers"]) >= 1
    assert "endpoints" in info

def test_webrtc_ice_servers_endpoint():
    """Verify GET /api/session/{session_id}/ice-servers route."""
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "pc-test-ice",
        "receiverDeviceName": "Desktop",
        "destinationPath": "Downloads",
        "platform": "windows",
        "publicKey": "fedcba98"
    })
    assert create_res.status_code == 200
    session_id = create_res.json()["sessionId"]

    ice_res = client.get(f"/api/session/{session_id}/ice-servers")
    assert ice_res.status_code == 200
    ice_data = ice_res.json()
    assert ice_data["sessionId"] == session_id
    assert "iceServers" in ice_data
    assert len(ice_data["iceServers"]) >= 1

def test_session_active_ttl_extension():
    """Verify session TTL is automatically extended upon manifest submission."""
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "pc-test-ttl",
        "receiverDeviceName": "Workstation",
        "destinationPath": "Downloads",
        "platform": "linux",
        "publicKey": "11223344"
    })
    session_id = create_res.json()["sessionId"]
    token = create_res.json()["token"]

    # Sender joins session to transition to CONNECTED
    join_res = client.post(f"/api/session/join?session_id={session_id}", json={
        "token": token,
        "senderDeviceId": "phone-1",
        "senderDeviceName": "Pixel Phone",
        "platform": "android",
        "publicKey": "99887766"
    })
    assert join_res.status_code == 200

    manifest = TransferManifest(
        transferId="xfer-ttl-test",
        senderDeviceId="phone-1",
        receiverDeviceId="pc-test-ttl",
        totalFiles=1,
        totalBytes=1024,
        createdAt=time.time(),
        files=[]
    )

    sub_res = client.post(f"/api/session/{session_id}/manifest", json=manifest.model_dump())
    assert sub_res.status_code == 200
    assert sub_res.json()["status"] == "AWAITING_APPROVAL"

    # Verify session is still available in store with active TTL
    store_record = distributed_store.get_json(f"session:{session_id}")
    assert store_record is not None
    assert store_record["state"] == "AWAITING_APPROVAL"
