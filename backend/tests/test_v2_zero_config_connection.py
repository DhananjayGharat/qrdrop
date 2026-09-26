import pytest
import os
import socket
import hashlib
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.networking.lan_discovery import (
    get_primary_network_info,
    scan_network_interfaces,
    get_network_diagnostics
)
from backend.app.networking.port_manager import find_available_port, is_port_available
from backend.app.security.crypto import generate_ecdh_keypair, calculate_sha256_bytes

@pytest.fixture
def client():
    return TestClient(app)

def test_qr_contains_real_local_connection_url(client, tmp_path):
    """
    V2 Core Requirement 3:
    The QR must contain a real local connection URL:
    http://<LOCAL-IP>:<PORT>/connect/<TEMP_SESSION_TOKEN>
    """
    _, pub = generate_ecdh_keypair()
    res = client.post("/api/session/create", json={
        "receiverDeviceId": "test-laptop-1",
        "receiverDeviceName": "Dhananjay's Laptop",
        "destinationPath": str(tmp_path),
        "platform": "windows",
        "publicKey": pub
    })
    assert res.status_code == 200
    data = res.json()

    assert "connectUrl" in data
    assert data["connectUrl"].startswith("http://")
    assert "/connect/" in data["connectUrl"]
    assert data["token"] in data["connectUrl"]
    assert data["qrPayload"] == data["connectUrl"]
    assert data["qrDataUri"].startswith("data:image/png;base64,")

def test_token_lookup_and_device_detection(client, tmp_path):
    """
    V2 Requirements 14 & 17:
    Sender opens URL, validates token, registers sender,
    and receiver is notified immediately with DEVICE_DETECTED.
    """
    _, pub = generate_ecdh_keypair()
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "test-laptop-2",
        "receiverDeviceName": "Dhananjay's Laptop",
        "destinationPath": str(tmp_path),
        "platform": "windows",
        "publicKey": pub
    })
    session_data = create_res.json()
    token = session_data["token"]
    session_id = session_data["sessionId"]

    # Sender simulates opening the URL in iPhone Safari
    lookup_res = client.get(
        f"/api/session/lookup-token?token={token}&device_name=Dhananjay's%20iPhone&platform=ios&browser=Safari"
    )
    assert lookup_res.status_code == 200
    lookup_data = lookup_res.json()
    assert lookup_data["valid"] is True
    assert lookup_data["sessionId"] == session_id
    assert lookup_data["receiverDeviceName"] == "Dhananjay's Laptop"
    assert lookup_data["protocolVersion"] == "QRDTP/1"

    # Verify session state updated with detected device info
    get_res = client.get(f"/api/session/{session_id}")
    assert get_res.status_code == 200
    session_status = get_res.json()
    assert session_status["detectedDevice"] is not None
    assert session_status["detectedDevice"]["name"] == "Dhananjay's iPhone"
    assert session_status["detectedDevice"]["browser"] == "Safari"

def test_token_single_use_and_replay_protection(client, tmp_path):
    """
    V2 Requirements 13 & 18:
    Single-use token with replay attack protection.
    Once paired/joined, the token cannot be reused.
    """
    _, pub = generate_ecdh_keypair()
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "laptop-secure",
        "receiverDeviceName": "Secure Receiver",
        "destinationPath": str(tmp_path),
        "platform": "windows",
        "publicKey": pub
    })
    token = create_res.json()["token"]
    session_id = create_res.json()["sessionId"]

    # First join: succeeds
    _, sender_pub = generate_ecdh_keypair()
    join1 = client.post(f"/api/session/join?session_id={session_id}", json={
        "token": token,
        "senderDeviceId": "phone-1",
        "senderDeviceName": "Alice's Phone",
        "platform": "android",
        "publicKey": sender_pub
    })
    assert join1.status_code == 200
    assert join1.json()["state"] == "CONNECTED"

    # Replay attack attempt: second join with the same token MUST be rejected
    join2 = client.post(f"/api/session/join?session_id={session_id}", json={
        "token": token,
        "senderDeviceId": "phone-attacker",
        "senderDeviceName": "Eve's Phone",
        "platform": "android",
        "publicKey": sender_pub
    })
    assert join2.status_code in {403, 404}

    # Token lookup should now also reject the consumed token
    lookup = client.get(f"/api/session/lookup-token?token={token}")
    assert lookup.status_code in {400, 404}

def test_lan_discovery_and_interface_prioritization():
    """
    V2 Requirements 9 & 10:
    LAN discovery avoids virtual/VPN/APIPA interfaces,
    and returns valid IPv4 network info.
    """
    info = get_primary_network_info()
    assert "ip" in info
    assert "interface" in info
    assert "network_type" in info

    # If connected to network, IP should not be loopback or APIPA
    if info["is_connected"]:
        assert not info["ip"].startswith("127.")
        assert not info["ip"].startswith("169.254.")

def test_port_manager_and_dynamic_selection():
    """
    V2 Requirement 11:
    Port management dynamically finds available port when preferred is occupied.
    """
    # Find base available port
    p1 = find_available_port(9100)
    assert p1 >= 9100

    # Temporarily bind to p1
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("0.0.0.0", p1))
    sock.listen(1)

    try:
        # Requesting p1 should now bump to an available port (e.g. p1 + 1)
        p2 = find_available_port(p1)
        assert p2 != p1
        assert p2 > p1
    finally:
        sock.close()

def test_developer_diagnostics_endpoint(client):
    """
    V2 Requirement 39:
    Developer diagnostics panel data endpoint.
    """
    res = client.get("/api/session/diagnostics/network")
    assert res.status_code == 200
    data = res.json()
    assert "interfaceName" in data
    assert "primaryIp" in data
    assert "port" in data
    assert "networkType" in data
    assert "firewallStatus" in data
    assert "candidateInterfaces" in data

def test_connect_endpoint_serves_spa(client):
    """
    V2 Requirements 4 & 5:
    Normal phone camera visits http://<IP>:<PORT>/connect/<token>.
    Server responds with HTML (SPA).
    """
    res = client.get("/connect/TESTTOKEN123")
    assert res.status_code == 200
    assert "text/html" in res.headers.get("content-type", "")

def test_full_zero_config_mobile_camera_flow_e2e(client, tmp_path):
    """
    Full Scenario (Requirement 33 & 43):
    1. Laptop chooses destination and generates QR with URL.
    2. Phone opens URL -> hits /connect/<token>.
    3. Phone browser calls lookup-token -> receiver gets DEVICE_DETECTED.
    4. Phone joins session -> pairs without IP/port typing.
    5. Receiver approves session.
    6. Phone streams chunked files with SHA-256 verification.
    7. File verified and committed.
    """
    dest_dir = str(tmp_path / "camera_received")
    os.makedirs(dest_dir, exist_ok=True)

    # 1. Receiver generates QR
    _, recv_pub = generate_ecdh_keypair()
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "laptop-101",
        "receiverDeviceName": "Dhananjay's Laptop",
        "destinationPath": dest_dir,
        "platform": "windows",
        "publicKey": recv_pub
    })
    assert create_res.status_code == 200
    create_data = create_res.json()
    token = create_data["token"]
    session_id = create_data["sessionId"]
    connect_url = create_data["connectUrl"]

    # 2. Camera scans connect_url and phone browser loads it
    assert "/connect/" in connect_url
    browser_page_res = client.get(f"/connect/{token}")
    assert browser_page_res.status_code == 200

    # 3. Phone browser looks up token and triggers device detection
    lookup = client.get(
        f"/api/session/lookup-token?token={token}&device_name=Dhananjay's%20iPhone&platform=ios&browser=Safari"
    )
    assert lookup.status_code == 200
    assert lookup.json()["receiverDeviceName"] == "Dhananjay's Laptop"

    # Receiver checks status and sees detected device
    status_check = client.get(f"/api/session/{session_id}").json()
    assert status_check["detectedDevice"]["name"] == "Dhananjay's iPhone"

    # 4. Phone joins session
    _, phone_pub = generate_ecdh_keypair()
    join_res = client.post(f"/api/session/join?session_id={session_id}", json={
        "token": token,
        "senderDeviceId": "phone-505",
        "senderDeviceName": "Dhananjay's iPhone",
        "platform": "ios",
        "publicKey": phone_pub,
        "browser": "Safari"
    })
    assert join_res.status_code == 200
    assert join_res.json()["state"] == "CONNECTED"

    # 5. Receiver approves session
    approve_res = client.post(f"/api/session/{session_id}/approve", json={"approved": True})
    assert approve_res.status_code == 200

    # 6. Phone sends file
    payload = b"QRDrop V2 Zero-Config Local Transfer: 100% Direct LAN verified!" * 1024
    payload_sha = hashlib.sha256(payload).hexdigest()
    transfer_id = "cam-xfer-1"
    file_id = "cam-file-1"

    manifest = {
        "transferId": transfer_id,
        "senderDeviceId": "phone-505",
        "receiverDeviceId": "laptop-101",
        "totalFiles": 1,
        "totalBytes": len(payload),
        "createdAt": 100.0,
        "files": [{
            "fileId": file_id,
            "fileName": "Vacation.mp4",
            "relativePath": "",
            "fileSize": len(payload),
            "mimeType": "video/mp4",
            "sha256Hash": payload_sha,
            "totalChunks": 1,
            "chunkSize": len(payload)
        }]
    }

    client.post(f"/api/session/{session_id}/manifest", json=manifest)

    # Register file on receiver
    reg = client.post("/api/transfer/register-file", json={
        "sessionId": session_id,
        "transferId": transfer_id,
        "fileMetadata": manifest["files"][0],
        "conflictMode": "keep_both"
    })
    assert reg.status_code == 200

    # Upload chunk
    ack = client.post(
        "/api/transfer/upload-chunk",
        data={
            "transferId": transfer_id,
            "fileId": file_id,
            "chunkIndex": 0,
            "offset": 0,
            "checksum": calculate_sha256_bytes(payload)
        },
        files={"chunkFile": ("chunk.bin", payload, "application/octet-stream")}
    )
    assert ack.status_code == 200
    assert ack.json()["status"] == "OK"

    # 7. Finalize and verify
    fin = client.post("/api/transfer/finalize-file", json={
        "transferId": transfer_id,
        "fileId": file_id
    })
    assert fin.status_code == 200
    assert fin.json()["status"] == "VERIFIED"
    assert fin.json()["sha256"].lower() == payload_sha.lower()

    # Verify physical file on disk
    saved_file = os.path.join(dest_dir, "Vacation.mp4")
    assert os.path.exists(saved_file)
    with open(saved_file, "rb") as f:
        assert f.read() == payload
