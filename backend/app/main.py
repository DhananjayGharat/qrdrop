import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.app.core.config import settings
from backend.app.api.session_routes import router as session_router
from backend.app.api.transfer_routes import router as transfer_router
from backend.app.api.websocket_routes import router as websocket_router
from backend.app.networking.lan_discovery import get_local_lan_ips

app = FastAPI(
    title="QRDrop API",
    description="Universal Cross-Platform High-Speed File Transfer Backend",
    version="1.0.0"
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

@app.get("/api/health")
async def health_check():
    """Health check endpoint providing runtime network interfaces and capability info."""
    return {
        "status": "healthy",
        "service": "QRDrop",
        "version": "1.0.0",
        "protocol": "QRDTP/1",
        "lanIps": get_local_lan_ips(),
        "port": settings.PORT,
        "defaultChunkSize": settings.DEFAULT_CHUNK_SIZE,
        "maxChunkSize": settings.MAX_CHUNK_SIZE,
        "stunServers": settings.stun_server_list,
    }

# Mount Web Client build if it exists
web_dist = Path(__file__).resolve().parent.parent.parent / "apps" / "web" / "dist"
if web_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(web_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = web_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(web_dist / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
