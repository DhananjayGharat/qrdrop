import pytest
import os
import hashlib
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.security.crypto import generate_ecdh_keypair, calculate_sha256_bytes

@pytest.fixture
def client(tmp_path):
    # Set default download destination to tmp_path
    return TestClient(app)

def test_full_e2e_transfer_workflow(client, tmp_path):
    dest_dir = str(tmp_path / "received_files")
    os.makedirs(dest_dir, exist_ok=True)

    # 1. Receiver creates session
    _, recv_pub = generate_ecdh_keypair()
    create_res = client.post("/api/session/create", json={
        "receiverDeviceId": "recv-101",
        "receiverDeviceName": "Dhananjay's Laptop",
        "destinationPath": dest_dir,
        "platform": "windows",
        "publicKey": recv_pub
    })
    assert create_res.status_code == 200
    session_data = create_res.json()
    session_id = session_data["sessionId"]
    token = session_data["token"]
    assert session_data["qrDataUri"].startswith("data:image/png;base64,")

    # 2. Sender scans QR and joins session
    _, send_pub = generate_ecdh_keypair()
    join_res = client.post(f"/api/session/join?session_id={session_id}", json={
        "token": token,
        "senderDeviceId": "send-202",
        "senderDeviceName": "Pixel Phone",
        "platform": "android",
        "publicKey": send_pub
    })
    assert join_res.status_code == 200
    assert join_res.json()["state"] == "CONNECTED"

    # 3. Sender prepares and submits manifest
    file_bytes = os.urandom(1024 * 512)  # 512 KB
    file_sha256 = hashlib.sha256(file_bytes).hexdigest()
    transfer_id = "test-xfer-999"
    file_id = "file-abc-1"

    manifest = {
        "transferId": transfer_id,
        "senderDeviceId": "send-202",
        "receiverDeviceId": "recv-101",
        "totalFiles": 1,
        "totalBytes": len(file_bytes),
        "createdAt": 1000.0,
        "files": [{
            "fileId": file_id,
            "fileName": "sample_video.mp4",
            "relativePath": "vacation",
            "fileSize": len(file_bytes),
            "mimeType": "video/mp4",
            "sha256Hash": file_sha256,
            "totalChunks": 2,
            "chunkSize": 256 * 1024
        }]
    }

    manifest_res = client.post(f"/api/session/{session_id}/manifest", json=manifest)
    assert manifest_res.status_code == 200

    # 4. Receiver approves transfer
    approve_res = client.post(f"/api/session/{session_id}/approve", json={"approved": True})
    assert approve_res.status_code == 200
    assert approve_res.json()["status"] == "APPROVED"

    # 5. Register file on receiver
    reg_res = client.post("/api/transfer/register-file", json={
        "sessionId": session_id,
        "transferId": transfer_id,
        "fileMetadata": manifest["files"][0],
        "conflictMode": "keep_both"
    })
    assert reg_res.status_code == 200
    assert reg_res.json()["status"] == "ready"

    # 6. Stream chunks
    chunk1 = file_bytes[:256 * 1024]
    chunk2 = file_bytes[256 * 1024:]

    # Upload chunk 0
    ack1 = client.post(
        "/api/transfer/upload-chunk",
        data={
            "transferId": transfer_id,
            "fileId": file_id,
            "chunkIndex": 0,
            "offset": 0,
            "checksum": calculate_sha256_bytes(chunk1)
        },
        files={"chunkFile": ("chunk0.bin", chunk1, "application/octet-stream")}
    )
    assert ack1.status_code == 200
    assert ack1.json()["status"] == "OK"

    # Upload chunk 1
    ack2 = client.post(
        "/api/transfer/upload-chunk",
        data={
            "transferId": transfer_id,
            "fileId": file_id,
            "chunkIndex": 1,
            "offset": 256 * 1024,
            "checksum": calculate_sha256_bytes(chunk2)
        },
        files={"chunkFile": ("chunk1.bin", chunk2, "application/octet-stream")}
    )
    assert ack2.status_code == 200
    assert ack2.json()["status"] == "OK"

    # 7. Finalize file: receiver performs SHA-256 verification and commits
    finalize_res = client.post("/api/transfer/finalize-file", json={
        "transferId": transfer_id,
        "fileId": file_id
    })
    assert finalize_res.status_code == 200
    assert finalize_res.json()["status"] == "VERIFIED"
    assert finalize_res.json()["sha256"].lower() == file_sha256.lower()

    # 8. Verify file on disk
    expected_path = os.path.join(dest_dir, "vacation", "sample_video.mp4")
    assert os.path.exists(expected_path)
    with open(expected_path, "rb") as f:
        assert f.read() == file_bytes

    # 9. Verify History API
    hist_record = {
        "id": "hist-1",
        "transferId": transfer_id,
        "timestamp": 1234567.0,
        "direction": "receive",
        "remoteDeviceName": "Pixel Phone",
        "remotePlatform": "android",
        "transport": "DIRECT_LAN",
        "fileCount": 1,
        "totalBytes": len(file_bytes),
        "durationSeconds": 0.5,
        "avgSpeedBytesPerSec": 1024 * 1024,
        "status": "completed",
        "fileNames": ["sample_video.mp4"]
    }
    client.post("/api/session/history/record", json=hist_record)
    get_hist = client.get("/api/session/history/list")
    assert get_hist.status_code == 200
    assert len(get_hist.json()) >= 1
    assert get_hist.json()[0]["remoteDeviceName"] == "Pixel Phone"
