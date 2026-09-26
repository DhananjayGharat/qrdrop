import pytest
import socket
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.config import settings
from backend.app.networking.lan_discovery import (
    get_primary_network_info,
    get_network_diagnostics,
    verify_local_health,
    scan_network_interfaces,
    get_local_lan_ips
)
from backend.app.networking.port_manager import find_available_port, is_port_available
from backend.app.services.session_service import session_service
from backend.app.models.schemas import SessionCreateRequest

client = TestClient(app)

def test_endpoint_health():
    """Requirement 7: Test that GET /health returns { status: 'ok', service: 'qrdrop', version: '2.0' }"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "qrdrop"
    assert data["version"] == "2.0"

def test_endpoint_api_health():
    """Test detailed GET /api/health returns runtime info and bind host 0.0.0.0"""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "qrdrop"
    assert data["bindHost"] == "0.0.0.0"
    assert "primaryIp" in data
    assert "port" in data

def test_server_bind_host_is_all_interfaces():
    """Requirement 1: Verify server binds to 0.0.0.0, NOT 127.0.0.1 or localhost."""
    assert settings.HOST == "0.0.0.0"

def test_dynamic_ip_detection_not_hardcoded():
    """Requirement 3: Verify dynamic IP detection never hardcodes an IP."""
    net_info = get_primary_network_info()
    assert "ip" in net_info
    assert net_info["ip"] != "127.0.0.1" or not net_info["is_connected"]
    
    candidates = scan_network_interfaces()
    assert len(candidates) > 0
    for c in candidates:
        # Loopback and APIPA addresses must be filtered out
        assert not c["ip"].startswith("127.")
        assert not c["ip"].startswith("169.254.")
        assert c["ip"] != "0.0.0.0"

def test_port_manager_dynamic_selection_when_busy():
    """Requirement 5: Test dynamic port selection when default port is busy."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    busy_port = s.getsockname()[1]
    s.listen(1)
    
    try:
        assert not is_port_available(busy_port, host="127.0.0.1")
        selected_port = find_available_port(preferred_port=busy_port)
        assert selected_port != busy_port
    finally:
        s.close()

def test_session_create_reachability_preflight_and_qr_url():
    """Requirement 2 & 8: Verify reachability check and actual port in QR URL."""
    req = SessionCreateRequest(
        receiverDeviceId="test-pc-receiver",
        receiverDeviceName="Windows PC",
        destinationPath="Downloads/QRDrop",
        platform="windows",
        publicKey="deadbeef01020304"
    )
    
    # Test session creation on port 54321
    res = session_service.create_session(req, port=54321)
    assert res.connectUrl.startswith("http://")
    assert ":54321/connect/" in res.connectUrl
    assert res.qrPayload == res.connectUrl
    assert res.networkInfo is not None
    assert "bindHost" in res.networkInfo
    assert res.networkInfo["bindHost"] == "0.0.0.0"

def test_network_diagnostics_endpoint_fields():
    """Requirement 7 & 13: Verify network diagnostics endpoint returns all required fields."""
    response = client.get("/api/session/diagnostics/network")
    assert response.status_code == 200
    diag = response.json()
    assert diag["bindHost"] == "0.0.0.0"
    assert "primaryIp" in diag
    assert "port" in diag
    assert "portListening" in diag
    assert "isReachable" in diag
    assert "firewallStatus" in diag
    assert "troubleshootingTips" in diag
    assert len(diag["troubleshootingTips"]) >= 3

def test_user_selected_ip_in_session_creation():
    """Requirement 4: Verify that user can specify a candidate interface IP."""
    req = SessionCreateRequest(
        receiverDeviceId="test-pc-receiver",
        receiverDeviceName="Windows PC",
        destinationPath="Downloads/QRDrop",
        platform="windows",
        publicKey="deadbeef01020304",
        selectedIp="192.168.1.106"
    )
    res = session_service.create_session(req, port=8000)
    assert "192.168.1.106:8000/connect/" in res.connectUrl
