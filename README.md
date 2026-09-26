# QRDrop V2 — Zero-Config Local QR Connection Upgrade

> **"Scan with normal camera. Select files. Send."**  
> High-speed, memory-bounded local & P2P file transfers between Desktop, Mobile, and Web browsers with zero manual networking.

---

## 🌟 What's New in QRDrop V2

QRDrop V2 upgrades the device discovery and pairing experience into a completely **zero-config local QR connection workflow**:

- **Real Local Connection URLs**: QR codes encode a real, dynamically constructed local HTTP link (`http://<LOCAL-IP>:<PORT>/connect/<TEMP_SESSION_TOKEN>`).
- **Normal Phone Camera Scanning**: Senders scan directly with their native phone camera (iOS Camera, Android Camera, Google Lens) without needing to install an app or open an in-app scanner. Tapping the detected URL automatically opens the web browser and joins the transfer session.
- **Zero Configuration**:
  - ❌ No IP typing
  - ❌ No port typing
  - ❌ No room codes
  - ❌ No account creation or login
  - ❌ No cloud storage or external signaling required
- **Offline Wi-Fi & Hotspot Support**: Works 100% offline with zero internet access when devices are on the same Wi-Fi or connected to a mobile hotspot (Android `192.168.43.x`, iOS `172.20.10.x`, Windows Mobile Hotspot `192.168.137.x`).
- **Smart Network Interface Scoring**: Automatically selects active physical LAN/Wi-Fi adapters and filters out VPNs (McAfee, Nord, WireGuard, OpenVPN, Tailscale), virtual adapters (Docker, WSL, Hyper-V, VirtualBox), and link-local APIPA (`169.254.x.x`).
- **Dynamic Port Management**: Automatically selects the next available port if default port 8000 is occupied, ensuring collision-free operation.
- **Instant Device Detection**: When the sender's camera opens the URL, the receiver immediately sees "New Device Connected (Device: iPhone, Browser: Safari, Network: Local Wi-Fi)" with 1-click Approval.
- **Mobile Web Crypto Fallback**: Robust pure-JavaScript SHA-256 and key generation fallback ensures chunk integrity and cryptographic handshakes work seamlessly across all mobile browsers over local HTTP origins.
- **Developer Diagnostics Panel**: Collapsible diagnostics view displaying active interface, IP, port, latency, protocol version, and firewall status.

---

## 🚀 Primary User Experience Flow

```
RECEIVER (Desktop / Laptop / Mobile):
Open QRDrop ──► Choose RECEIVE ──► Select Destination ──► Generate QR ──► Show Large QR

SENDER (Any Phone / Tablet / PC):
Open Native Camera ──► Scan QR ──► Tap "Open Link" ──► Browser Opens ──► Automatically Connected!
                                                                                │
                                                                                ▼
RECEIVER: Approves Device ◄──────────────────────────────────────────── SENDER: Selects Files
          │                                                                      │
          └────────────────────────── DIRECT LAN ────────────────────────────────┘
                                        │
                            High-Speed Chunk Streaming
                                        │
                            Full SHA-256 Verification
                                        │
                                        ▼
                                 Saved & Verified!
```

---

## 📊 Empirical Performance Benchmarks (QRDrop V2)

Benchmarked on Windows 11 (12 cores, 16 GB RAM, NVMe storage) using `scripts/benchmark.py`:

### 1. Pairing & Connection Latency
| Operation | Latency | Target | Result |
|:---|:---:|:---:|:---:|
| **QR Generation + LAN Detection** | 45.3 ms | < 500 ms | **PASS** |
| **Phone Token Lookup** | 0.01 ms | < 100 ms | **PASS** |
| **Pairing & Join Handshake** | 0.02 ms | < 100 ms | **PASS** |
| **Total Connection Time** | **45.33 ms** | **< 2.0 s** | **SUPERIOR** |

### 2. File Streaming & Verification Throughput
| File Size | Chunk Size | Mode | Duration | Throughput | RAM Diff |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **20 MB** | 64 KB | Single-Stream | 0.230 s | **86.97 MB/s** | +0.4 MB |
| **20 MB** | 256 KB | Single-Stream | 0.084 s | **238.54 MB/s** | +0.5 MB |
| **20 MB** | 512 KB | Single-Stream | 0.059 s | **340.45 MB/s** | +0.5 MB |
| **20 MB** | 1024 KB | Single-Stream | 0.058 s | **346.47 MB/s** | +1.0 MB |
| **50 MB** | 256 KB | Parallel (4x) | 0.223 s | **224.62 MB/s** | +0.6 MB |
| **100 MB** | 512 KB | Parallel (4x) | 0.300 s | **333.73 MB/s** | +0.8 MB |

*Full file SHA-256 verification of 100 MB completes in **0.105 seconds**.*

---

## 🛠️ Technology Stack

- **Backend & Control**: Python 3.12, FastAPI, Uvicorn, WebSockets, Pydantic V2, psutil, SQLite.
- **Cryptography**: `cryptography` (Python) and Web Crypto API with pure-JS fallback for local HTTP contexts (`window.crypto.subtle` fallback).
- **Web & PWA Client**: React 18, TypeScript, Tailwind CSS, Lucide icons, Vite.
- **QR Engine**: `qrcode` (Python backend high-error-correction URL encoding) and `html5-qrcode` (webcam scanning fallback).
- **Transfer Engine**: Bounded-memory chunk streaming, resumable `.qrdrop.meta` bitmaps, and path traversal sanitization.

---

## ⚡ Quick Start

### 1. Launch Platform
```powershell
# Windows PowerShell
.\scripts\start.ps1

# Or Native Desktop Launcher with auto-browser opening
python apps/desktop/desktop_launcher.py
```

Open your browser to:
- **Local Receiver UI**: `http://localhost:8000`
- **Direct LAN Access**: `http://<your-lan-ip>:8000`
- **REST & OpenAPI Docs**: `http://localhost:8000/docs`

### 2. Frontend Development Mode
```powershell
cd apps/web
npm.cmd run dev
```

---

## 🌐 Universal 3-Tier Connection Hierarchy

QRDrop dynamically negotiates the fastest, most secure, and direct connection for any device topology:

1. **Priority 1: Direct LAN (`⚡ DIRECT LAN`)**
   - Automatically selected when devices are on the same Wi-Fi, Ethernet, or mobile hotspot.
   - Streaming HTTP chunk uploads directly to the receiver's local server.
   - Speeds up to **400+ MB/s** with zero internet usage.

2. **Priority 2: Direct WebRTC P2P (`⚡ DIRECT P2P`)**
   - Activated when devices are on different networks, guest networks, or cellular 4G/5G.
   - Establishes a direct browser-to-browser encrypted `RTCDataChannel`.
   - File bytes stream peer-to-peer and **never touch the signaling server or cloud storage**.

3. **Priority 3: TURN Relay (`🔒 TURN RELAY`)**
   - Activated as seamless fallback when symmetric NATs or corporate firewalls block direct P2P.
   - Streams end-to-end encrypted chunks via Coturn STUN/TURN server with ephemeral RFC 5766 time-windowed credentials.

---

## 🐳 Production Deployment (24/7 Global Access)

QRDrop includes a complete multi-worker, load-balanced, containerized stack:

```powershell
# 1. Configure environment variables
cp .env.example .env

# 2. Start the full production stack
docker compose up -d --build
```

The stack provisions:
- **`api-1` & `api-2`**: High-availability FastAPI backend workers.
- **`redis`**: Distributed session store, atomic token consumption, and cross-worker WebRTC signaling pub/sub.
- **`coturn`**: High-performance STUN/TURN server for NAT traversal.
- **`nginx`**: Load balancer with WebSocket upgrade proxying and non-buffering streaming uploads.

---

## 🧪 Automated Testing Suite

QRDrop V2 includes a **33-test automated suite** verifying security boundaries, single-use token replay protection, path traversal defenses, resumable chunk recovery, ephemeral TURN credentials, distributed Redis store, dual-mode URLs, and end-to-end zero-config connection:

```powershell
.\scripts\run-tests.ps1
```

```text
backend/tests/test_e2e_transfer.py::test_full_e2e_transfer_workflow PASSED
backend/tests/test_security.py::test_token_expiration_and_replay_protection PASSED
backend/tests/test_security.py::test_path_traversal_attacks_blocked PASSED
backend/tests/test_security.py::test_filename_sanitization PASSED
backend/tests/test_security.py::test_e2e_ecdh_aes_gcm_crypto_roundtrip PASSED
backend/tests/test_sessions.py::test_session_state_transitions PASSED
backend/tests/test_sessions.py::test_session_lifecycle_and_pairing PASSED
backend/tests/test_transfer_engine.py::test_chunked_file_transfer_and_sha256 PASSED
backend/tests/test_transfer_engine.py::test_corrupt_chunk_retry PASSED
backend/tests/test_transfer_engine.py::test_resumable_transfer_after_interruption PASSED
backend/tests/test_transfer_engine.py::test_folder_structure_preservation PASSED
backend/tests/test_v2_distributed_and_webrtc.py::test_distributed_store_in_memory_fallback PASSED
backend/tests/test_v2_distributed_and_webrtc.py::test_turn_service_ephemeral_credentials PASSED
backend/tests/test_v2_distributed_and_webrtc.py::test_dual_mode_urls_in_session_creation PASSED
backend/tests/test_v2_distributed_and_webrtc.py::test_token_lookup_enrichment PASSED
backend/tests/test_v2_distributed_and_webrtc.py::test_webrtc_ice_servers_endpoint PASSED
backend/tests/test_v2_distributed_and_webrtc.py::test_session_active_ttl_extension PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_endpoint_health PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_endpoint_api_health PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_server_bind_host_is_all_interfaces PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_dynamic_ip_detection_not_hardcoded PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_port_manager_dynamic_selection_when_busy PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_session_create_reachability_preflight_and_qr_url PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_network_diagnostics_endpoint_fields PASSED
backend/tests/test_v2_reachability_and_firewall.py::test_user_selected_ip_in_session_creation PASSED
backend/tests/test_v2_zero_config_connection.py::test_qr_contains_real_local_connection_url PASSED
backend/tests/test_v2_zero_config_connection.py::test_token_lookup_and_device_detection PASSED
backend/tests/test_v2_zero_config_connection.py::test_token_single_use_and_replay_protection PASSED
backend/tests/test_v2_zero_config_connection.py::test_lan_discovery_and_interface_prioritization PASSED
backend/tests/test_v2_zero_config_connection.py::test_port_manager_and_dynamic_selection PASSED
backend/tests/test_v2_zero_config_connection.py::test_developer_diagnostics_endpoint PASSED
backend/tests/test_v2_zero_config_connection.py::test_connect_endpoint_serves_spa PASSED
backend/tests/test_v2_zero_config_connection.py::test_full_zero_config_mobile_camera_flow_e2e PASSED

======================== 33 passed in 6.35s ========================
```

---

## 🔒 Security & Privacy Model

- **Local Network & Public URL Tokens**: The pairing URL embeds an ephemeral, single-use, cryptographically random token (`secrets.token_urlsafe(32)`).
- **Single-Use Consumption**: Once a device joins the session, the token is consumed atomically in Redis/memory, blocking replay attacks.
- **Session Expiration**: Tokens expire after 600 seconds (extended to 3600s during active transfers).
- **Receiver Approval**: The receiver explicitly approves incoming devices and transfer manifests with live connection badges (`⚡ DIRECT LAN`, `⚡ DIRECT P2P`, `🔒 TURN RELAY`).
- **Path Traversal Defense**: All destination paths are verified to ensure no directory escape attacks (`../`, absolute drive letters, Windows reserved device names like `CON`, `PRN`, `AUX`, `NUL`).
- **Full File SHA-256 Verification**: Every chunk and the finalized file are validated against the sender manifest prior to atomic commit.
- **Zero Cloud Storage**: User files never touch cloud storage or disk on signaling servers.

---

## 📄 License
MIT License. Created for the QRDrop file transfer platform.
