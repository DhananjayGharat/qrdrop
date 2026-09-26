# QRDrop Developer & Operational Guide

## 1. Prerequisites

- **Python**: 3.10+ (tested on Python 3.12)
- **Node.js**: 18+ (tested on Node v24.19 / npm 11.17)
- **Git**

---

## 2. Project Layout

```
QRDrop/
├── apps/
│   ├── web/            # React 18 + TypeScript + Vite + Tailwind CSS PWA
│   ├── desktop/        # Desktop runner & native browser launcher
│   └── mobile/         # Mobile PWA manifest & Service Worker configs
├── backend/            # FastAPI + Uvicorn + SQLite control engine
│   ├── app/
│   │   ├── api/        # REST & WebSocket endpoints (/session, /transfer, /ws)
│   │   ├── core/       # Configuration & State machine (QRDTP/1)
│   │   ├── models/     # Pydantic schemas (Manifest, Chunk, Session)
│   │   ├── networking/ # LAN IP discovery & WebSocket signaling/relay
│   │   ├── security/   # Token manager, path traversal sanitizer, crypto
│   │   ├── services/   # Session & SQLite history services
│   │   └── transfer/   # Streaming chunk engine, resume, SHA-256 verify
│   └── tests/          # Pytest suite (Security, State, Resumable Transfer, E2E)
├── shared/
│   ├── protocol/       # QRDTP/1 TypeScript types & contracts
│   └── crypto/         # Web Crypto API & Python Cryptography primitives
├── docs/               # Architecture, Security, Protocol, Performance docs
├── scripts/            # Run scripts, benchmarks, test automation
└── README.md
```

---

## 3. Quick Start

### 1. Start the Complete Platform (Single Command)
```powershell
# From project root:
.\scripts\start.ps1
# Or on cmd:
scripts\start.bat
```
The FastAPI backend will automatically host:
- REST API: `http://localhost:8000/api`
- OpenAPI Docs: `http://localhost:8000/docs`
- Compiled Web App: `http://localhost:8000`
- Direct LAN Access: `http://<LAN-IP>:8000`

### 2. Frontend Development Server (Hot Module Reloading)
```powershell
cd apps/web
npm run dev
```
Runs Vite on `http://localhost:5173` proxying `/api` requests to backend at `:8000`.

---

## 4. Running Automated Tests

Run the full 11-test automated suite:
```powershell
.\scripts\run-tests.ps1
```
Or directly via pytest:
```powershell
$env:PYTHONPATH = "."
python -m pytest backend/tests/ -v
```

### Running Performance Benchmarks
```powershell
$env:PYTHONPATH = "."
python scripts/benchmark.py
```
Outputs empirical speeds (MB/s), duration, and RAM overhead for 20MB, 50MB, and 100MB files across 64KB, 256KB, 512KB, and 1MB chunk configurations.
