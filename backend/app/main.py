import os
import logging
from typing import Optional
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from backend.app.core.config import settings
from backend.app.api.session_routes import router as session_router
from backend.app.api.transfer_routes import router as transfer_router
from backend.app.api.websocket_routes import router as websocket_router, ws_root_router
from backend.app.networking.lan_discovery import (
    get_local_lan_ips,
    get_primary_network_info,
    get_network_diagnostics
)
from backend.app.networking.port_manager import find_available_port

logger = logging.getLogger("qrdrop.main")

app = FastAPI(
    title="QRDrop API",
    description="Universal Cross-Platform High-Speed File Transfer Backend",
    version="2.0.0"
)

# Enable CORS for cross-device LAN and Web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(session_router)
app.include_router(transfer_router)
app.include_router(websocket_router)
app.include_router(ws_root_router)

@app.get("/health")
async def basic_health_check():
    """
    Standard internal reachability and connectivity check endpoint.
    Used before generating the QR code to verify server is listening and responding.
    """
    return {
        "status": "ok",
        "service": "qrdrop",
        "version": "2.0"
    }

@app.get("/api/health")
async def health_check():
    """Detailed health check endpoint providing runtime network interfaces and capability info."""
    net_info = get_primary_network_info()
    return {
        "status": "ok",
        "service": "qrdrop",
        "version": "2.0",
        "protocol": "QRDTP/1",
        "primaryIp": net_info["ip"],
        "interface": net_info["interface"],
        "networkType": net_info["network_type"],
        "isHotspot": net_info["is_hotspot"],
        "lanIps": get_local_lan_ips(),
        "port": settings.PORT,
        "bindHost": settings.HOST,
        "defaultChunkSize": settings.DEFAULT_CHUNK_SIZE,
        "maxChunkSize": settings.MAX_CHUNK_SIZE,
        "stunServers": settings.stun_server_list,
    }

# Robust discovery of built Web Client SPA
def find_web_dist() -> Path:
    candidates = [
        Path(__file__).resolve().parent.parent.parent / "apps" / "web" / "dist",
        Path.cwd() / "apps" / "web" / "dist",
        Path("/app/apps/web/dist"),
        Path.cwd() / "dist",
    ]
    for p in candidates:
        if p.exists() and (p / "index.html").exists():
            return p
    return candidates[0]

web_dist = find_web_dist()

def get_spa_response(token: Optional[str] = None):
    index_file = web_dist / "index.html"
    if index_file.exists():
        resp = FileResponse(index_file)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return HTMLResponse(
        content=f"<html><head><title>QRDrop</title></head><body style='font-family:sans-serif;padding:2rem;text-align:center;'>"
                f"<h2>QRDrop Connecting...</h2>"
                f"<p>{f'Token: {token}' if token else 'Web client bundle loading...'}</p>"
                f"<p style='color:#888;'>Web client build not found at {web_dist}. Run 'npm run build' in apps/web.</p>"
                f"</body></html>",
        status_code=200
    )

@app.get("/connect")
@app.get("/connect/{token}")
@app.get("/connect/{token}/")
async def serve_connect_page(token: Optional[str] = None):
    """
    Dedicated endpoint for scanned QR connection URLs.
    Returns the Web Client SPA which auto-connects to the receiver session.
    """
    return get_spa_response(token)

if (web_dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(web_dist / "assets")), name="assets")

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Universal SPA static file and fallback handler."""
    file_path = web_dist / full_path
    if file_path.is_file():
        return FileResponse(file_path)
    return get_spa_response()

if __name__ == "__main__":
    import uvicorn
    # Dynamically verify / select available port
    actual_port = find_available_port(settings.PORT)
    settings.PORT = actual_port
    print(f"QRDrop Server Starting on {settings.HOST}:{actual_port}...")
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=actual_port, reload=settings.DEBUG)
