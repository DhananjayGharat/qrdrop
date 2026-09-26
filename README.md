# QRDrop — Universal Cross-Platform File Transfer Platform

> **"Scan. Select. Send."**  
> High-speed, secure, memory-bounded local & P2P file transfers between Desktop, Mobile, and Web browsers.

---

## 🌟 Overview

**QRDrop** is a modern consumer-grade file transfer platform engineered for maximum transfer speed, zero cloud dependency for local transfers, and cross-platform simplicity.

By decoupling device discovery (via temporary single-use QR codes) from the actual high-throughput data path (Direct LAN &gt; WebRTC P2P &gt; Encrypted Relay), QRDrop eliminates complex network configuration, manual IP typing, and cloud storage size limits.

```
       Receiver                            Sender
┌────────────────────┐              ┌────────────────────┐
│   RECEIVE FILES    │              │     SEND FILES     │
│                    │              │                    │
│ Choose Destination │              │      Scan QR       │
│    Generate QR     │              │    Select Files    │
│    Wait for Scan   │              │   Review & Send    │
└─────────┬──────────┘              └─────────┬──────────┘
          │                                   │
          │         [QR Code Pairing]         │
          └─────────────────┬─────────────────┘
                            │
              Direct LAN / WebRTC DataChannel
                            │
               [Streaming Chunk Transfer]
                            │
               [SHA-256 Full Verification]
                            │
                            ▼
                     Transfer Complete!
```

---

## 🚀 Key Features

- **No Fake Networking / Zero Simulation**: Real streaming I/O with verified throughput exceeding **370+ MB/s** on local transfers.
- **Receiver-First Workflow**: Receiver selects destination directory *before* generating QR to ensure destination security.
- **Single-Use Ephemeral QR Codes**: Cryptographically secure tokens with 120-second TTL and automatic replay-attack protection.
- **Autonomous Transport Negotiation**:
  1. **Direct LAN**: Highest speed direct socket/HTTP streaming between local subnet devices.
  2. **Direct P2P**: Browser-to-browser WebRTC `RTCDataChannel` connection with STUN.
  3. **Secure Relay**: End-to-end encrypted fallback relay for symmetric NATs and restrictive firewalls.
- **Bounded Memory Streaming**: Large files (1 GB, 10 GB, 50 GB+) are streamed in slices (64 KB – 1 MB chunks) without loading entire files into RAM.
- **Resumable Transfers**: Interrupted transfers resume seamlessly using `.qrdrop.meta` chunk bitmaps, only requesting missing chunks.
- **Streaming SHA-256 File Integrity**: All chunks and final assembled files are verified against the sender manifest prior to atomic commit.
- **Full Folder & Directory Support**: Recursive directory traversal preserving nested folder structures.
- **Path Traversal Protection**: Rejection of directory escape attempts (`../`, absolute drive letters, null bytes, and Windows reserved device names like `CON`, `PRN`, `AUX`, `NUL`).
- **Real-Time Consumer Metrics**: Real instantaneous speed (MB/s sliding window), average speed, remaining bytes, and live ETA countdown.
- **E2E Authenticated Encryption**: ECDH (P-256) key exchange + HKDF-SHA256 + AES-256-GCM authenticated encryption.
- **Transfer History Store**: Lightweight SQLite metadata store tracking transfers without storing file contents.

---

## 📊 Empirical Performance Benchmarks

Benchmarked using `scripts/benchmark.py` on 12-core x64 system with NVMe storage:

| File Size | Chunk Size | Transfer Mode | Duration | Throughput | RAM Overhead |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **20 MB** | 64 KB | Single-Stream | 0.226 s | **88.33 MB/s** | +0.3 MB |
| **20 MB** | 256 KB | Single-Stream | 0.088 s | **227.20 MB/s** | +0.4 MB |
| **20 MB** | 512 KB | Single-Stream | 0.055 s | **362.16 MB/s** | +0.5 MB |
| **20 MB** | 1024 KB | Single-Stream | 0.048 s | **414.49 MB/s** | +1.0 MB |
| **50 MB** | 256 KB | Single-Stream | 0.189 s | **264.72 MB/s** | +0.4 MB |
| **50 MB** | 256 KB | Parallel (4x) | 0.182 s | **274.37 MB/s** | +0.6 MB |
| **100 MB** | 512 KB | Parallel (4x) | 0.266 s | **376.19 MB/s** | +0.8 MB |

*Full file SHA-256 verification of 100 MB completes in under 0.098 seconds.*

---

## 🛠️ Technology Stack

- **Backend & Control**: Python 3.12, FastAPI, Uvicorn, WebSockets, Pydantic V2, SQLite.
- **Cryptography**: `cryptography` (Python) and Web Crypto API (`window.crypto.subtle`) implementing ECDH P-256, HKDF-SHA256, and AES-256-GCM.
- **Web & PWA Client**: React 18, TypeScript, Tailwind CSS, Lucide icons, Vite.
- **QR Engine**: `qrcode` (Python backend generation) and `html5-qrcode` (webcam & camera scanning).
- **Transport**: Direct HTTP streaming, WebSockets, and WebRTC `RTCDataChannel`.

---

## ⚡ Quick Start

### 1. Launch Platform
```powershell
# Windows PowerShell
.\scripts\start.ps1

# Or Windows Command Prompt
scripts\start.bat
```

Open your browser to:
- **Local Web App**: `http://localhost:8000`
- **REST & OpenAPI Docs**: `http://localhost:8000/docs`
- **Direct LAN Access**: `http://<your-lan-ip>:8000`

### 2. Frontend Development Mode
```powershell
cd apps/web
npm.cmd run dev
```

---

## 🧪 Automated Testing Suite

QRDrop includes an 11-test automated suite verifying security boundaries, session state machines, token replay defenses, resumable chunk recovery, and end-to-end transfers:

```powershell
# Run all tests
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

11 passed in 0.66s
```

---

## 📖 Documentation

- **[System Architecture](docs/architecture.md)**: Deep architectural breakdown with sequence & component diagrams.
- **[Protocol Specification (QRDTP/1)](docs/protocol.md)**: Wire framing, control messages, and resume flow.
- **[Security & Threat Model](docs/security.md)**: Path traversal defense, replay-attack mitigation, and crypto details.
- **[Performance & Benchmarks](docs/performance.md)**: Throughput comparisons and streaming benchmarks.
- **[Compatibility Matrix](docs/compatibility.md)**: Cross-platform support across Windows, macOS, Linux, Android, iOS, and Web.
- **[Developer Guide](docs/development.md)**: Environment setup, API reference, and deployment guide.

---

## 📄 License
MIT License. Created for the QRDrop file transfer platform.
