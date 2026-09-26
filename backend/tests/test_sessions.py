import pytest
import time
from backend.app.core.state import SessionState, InvalidStateTransitionError, validate_state_transition
from backend.app.services.session_service import SessionService
from backend.app.models.schemas import (
    SessionCreateRequest,
    SessionJoinRequest,
    TransferManifest,
    FileMetadata
)

def test_session_state_transitions():
    assert validate_state_transition(SessionState.CREATED, SessionState.QR_GENERATED) is True
    assert validate_state_transition(SessionState.QR_GENERATED, SessionState.WAITING) is True
    assert validate_state_transition(SessionState.WAITING, SessionState.PAIRING) is True
    assert validate_state_transition(SessionState.PAIRING, SessionState.CONNECTED) is True
    assert validate_state_transition(SessionState.CONNECTED, SessionState.AWAITING_APPROVAL) is True
    assert validate_state_transition(SessionState.AWAITING_APPROVAL, SessionState.APPROVED) is True
    assert validate_state_transition(SessionState.APPROVED, SessionState.TRANSFERRING) is True
    assert validate_state_transition(SessionState.TRANSFERRING, SessionState.VERIFYING) is True
    assert validate_state_transition(SessionState.VERIFYING, SessionState.COMPLETED) is True

    # Invalid jump from CREATED directly to COMPLETED must raise InvalidStateTransitionError
    with pytest.raises(InvalidStateTransitionError):
        validate_state_transition(SessionState.CREATED, SessionState.COMPLETED)

def test_session_lifecycle_and_pairing(tmp_path):
    service = SessionService()
    dest = str(tmp_path / "downloads")

    # 1. Receiver creates session
    create_req = SessionCreateRequest(
        receiverDeviceId="dev-receiver-1",
        receiverDeviceName="Test Receiver Laptop",
        destinationPath=dest,
        platform="windows",
        publicKey="04abcdef12345678"
    )
    res = service.create_session(create_req)
    assert res.sessionId is not None
    assert res.token is not None
    assert res.qrDataUri.startswith("data:image/png;base64,")
    assert res.state == SessionState.QR_GENERATED

    # 2. Sender joins with valid token
    join_req = SessionJoinRequest(
        token=res.token,
        senderDeviceId="dev-sender-1",
        senderDeviceName="Test Sender Phone",
        platform="android",
        publicKey="04987654fedcba00"
    )
    record = service.join_session(res.sessionId, join_req)
    assert record.state == SessionState.CONNECTED
    assert record.sender_device_id == "dev-sender-1"

    # 3. Sender submits manifest
    manifest = TransferManifest(
        transferId="xfer-1",
        senderDeviceId="dev-sender-1",
        receiverDeviceId="dev-receiver-1",
        totalFiles=1,
        totalBytes=1024,
        createdAt=time.time(),
        files=[
            FileMetadata(
                fileId="f-1",
                fileName="test.txt",
                fileSize=1024,
                totalChunks=1,
                chunkSize=1024
            )
        ]
    )
    service.submit_manifest(res.sessionId, manifest)
    assert record.state == SessionState.AWAITING_APPROVAL

    # 4. Receiver approves
    service.set_approval(res.sessionId, True)
    assert record.state == SessionState.APPROVED
