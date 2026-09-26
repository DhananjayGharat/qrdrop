"""
QRDrop Desktop Native Launcher (Windows / macOS / Linux)
Provides native desktop launcher, auto-detects LAN IPs, opens default browser,
and binds dynamically to available port.
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

from backend.app.networking.lan_discovery import get_primary_network_info, get_local_lan_ips
from backend.app.networking.port_manager import find_available_port
from backend.app.core.config import settings

def open_browser(port: int):
    time.sleep(1.2)
    net_info = get_primary_network_info()
    primary_ip = net_info["ip"]
    url = f"http://localhost:{port}"
    print("\n" + "=" * 60)
    print("QRDrop Desktop V2 Engine Active")
    print(f"Local Access: {url}")
    print(f"Direct LAN Access: http://{primary_ip}:{port}")
    print(f"Interface: {net_info['interface']} ({net_info['network_type']})")
    print("=" * 60 + "\n")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not automatically open browser: {e}")

def main():
    import uvicorn
    # Dynamically select an available port
    actual_port = find_available_port(settings.PORT)
    settings.PORT = actual_port

    browser_thread = threading.Thread(target=open_browser, args=(actual_port,), daemon=True)
    browser_thread.start()
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=actual_port, log_level="info")

if __name__ == "__main__":
    main()
