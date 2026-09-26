"""
QRDrop Desktop Native Launcher (Windows / macOS / Linux)
Provides native desktop launcher, auto-detects LAN IPs, opens default browser,
and binds to port 8000.
"""

import sys
import os
import webbrowser
import threading
import time
from pathlib import Path

# Add root directory to python path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(root_dir))

from backend.app.networking.lan_discovery import get_local_lan_ips
from backend.app.core.config import settings

def open_browser():
    time.sleep(1.2)
    lan_ips = get_local_lan_ips()
    primary_ip = lan_ips[0] if lan_ips else "127.0.0.1"
    url = f"http://localhost:{settings.PORT}"
    print("\n" + "=" * 60)
    print("QRDrop Desktop Engine Active")
    print(f"Local Access: {url}")
    print(f"Direct LAN Access: http://{primary_ip}:{settings.PORT}")
    print("=" * 60 + "\n")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not automatically open browser: {e}")

def main():
    import uvicorn
    browser_thread = threading.Thread(target=open_browser, daemon=True)
    browser_thread.start()
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, log_level="info")

if __name__ == "__main__":
    main()
