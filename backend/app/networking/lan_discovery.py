import socket
import logging
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional

try:
    import psutil
except ImportError:
    psutil = None

logger = logging.getLogger("qrdrop.lan_discovery")

# Keywords indicating virtual, container, or VPN adapters that should be deprioritized or excluded
VIRTUAL_KEYWORDS = [
    "mcafee", "docker", "vethernet", "wsl", "virtualbox", "vbox",
    "vmware", "hyper-v", "tailscale", "zerotier", "nord", "wireguard",
    "openvpn", "tun", "tap", "bluetooth", "pseudo", "loopback"
]

# Common mobile and desktop hotspot default IP prefixes
HOTSPOT_PREFIXES = [
    "192.168.43.",   # Android Wi-Fi hotspot default
    "172.20.10.",    # Apple iOS personal hotspot default
    "192.168.137.",  # Windows Mobile Hotspot default
]

HOTSPOT_KEYWORDS = ["hotspot", "softap", "hosted", "mobile hotspot", "tether", "wi-fi direct"]

def get_kernel_outbound_ip() -> Optional[str]:
    """
    Asks the OS network stack which local IP and interface it selects
    for outbound routing to the gateway/LAN.
    Works completely offline using standard UDP route resolution without sending data.
    """
    for probe_ip in ["8.8.8.8", "1.1.1.1", "192.168.1.1", "192.168.0.1", "10.0.0.1"]:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(0.2)
                s.connect((probe_ip, 80))
                ip = s.getsockname()[0]
                if ip and not ip.startswith("127.") and not ip.startswith("169.254.") and ip != "0.0.0.0":
                    return ip
        except Exception:
            continue
    return None

def scan_network_interfaces() -> List[Dict[str, Any]]:
    """
    Scans, filters, and scores all active system network interfaces.
    - Dynamically prioritizes Wi-Fi, Ethernet, and Mobile Hotspot adapters.
    - Eliminates loopback (127.0.0.1), link-local APIPA (169.254.x.x), Docker, WSL, and VM adapters.
    - Boosts interfaces chosen by the kernel routing table and those with active network traffic.
    - Completely offline capable.
    """
    candidates = []
    outbound_ip = get_kernel_outbound_ip()

    if psutil:
        try:
            stats = psutil.net_if_stats()
            addrs = psutil.net_if_addrs()
            io_counters = psutil.net_io_counters(pernic=True)

            for if_name, addr_list in addrs.items():
                stat = stats.get(if_name)
                is_up = stat.isup if stat else False
                if_lower = if_name.lower()

                # Get traffic activity on interface
                io = io_counters.get(if_name)
                has_traffic = (io.bytes_recv > 0 and io.bytes_sent > 0) if io else False

                for a in addr_list:
                    if a.family == socket.AF_INET:
                        ip = a.address
                        # Ignore loopback, APIPA, or unassigned addresses
                        if ip.startswith("127.") or ip.startswith("169.254.") or ip == "0.0.0.0":
                            continue

                        is_virtual = any(k in if_lower for k in VIRTUAL_KEYWORDS)
                        is_hotspot = any(ip.startswith(p) for p in HOTSPOT_PREFIXES) or any(k in if_lower for k in HOTSPOT_KEYWORDS)

                        score = 0
                        if is_up:
                            score += 100
                        else:
                            score -= 200

                        if is_virtual:
                            score -= 250

                        if is_hotspot:
                            score += 90

                        # Score by interface physical medium
                        if any(k in if_lower for k in ["wi-fi", "wifi", "wlan", "wireless"]):
                            score += 80
                            net_type = "WI-FI"
                        elif any(k in if_lower for k in ["ethernet", "eth", "en", "local area connection"]):
                            score += 70
                            net_type = "ETHERNET"
                        elif is_hotspot:
                            score += 60
                            net_type = "HOTSPOT"
                        else:
                            net_type = "LAN"

                        # Prefer kernel default outbound route IP
                        if outbound_ip and ip == outbound_ip:
                            score += 150

                        # Traffic bonus
                        if has_traffic:
                            score += 40

                        # Prefer standard private IPv4 ranges (RFC 1918)
                        if ip.startswith("192.168."):
                            score += 25
                        elif ip.startswith("10."):
                            score += 20
                        elif ip.startswith("172."):
                            score += 15

                        candidates.append({
                            "score": score,
                            "interface": if_name,
                            "ip": ip,
                            "is_up": is_up,
                            "is_virtual": is_virtual,
                            "is_hotspot": is_hotspot,
                            "network_type": net_type,
                            "netmask": a.netmask,
                            "speed": stat.speed if stat else 0,
                            "has_traffic": has_traffic,
                            "is_default_route": (ip == outbound_ip)
                        })
        except Exception as e:
            logger.warning(f"psutil network scan error: {e}")

    # Fallback to standard socket inspection if psutil produced no valid LAN IPs
    if not candidates:
        try:
            hostname = socket.gethostname()
            for ip in socket.gethostbyname_ex(hostname)[2]:
                if not ip.startswith("127.") and not ip.startswith("169.254.") and ":" not in ip:
                    is_hotspot = any(ip.startswith(p) for p in HOTSPOT_PREFIXES)
                    candidates.append({
                        "score": 60 + (30 if is_hotspot else 0) + (50 if ip == outbound_ip else 0),
                        "interface": "Default Network Adapter",
                        "ip": ip,
                        "is_up": True,
                        "is_virtual": False,
                        "is_hotspot": is_hotspot,
                        "network_type": "HOTSPOT" if is_hotspot else "WI-FI",
                        "netmask": "255.255.255.0",
                        "speed": 0,
                        "has_traffic": True,
                        "is_default_route": (ip == outbound_ip)
                    })
        except Exception:
            pass

    # Sort descending by priority score
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates

def get_primary_network_info(selected_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns the primary active network interface information.
    If selected_ip is specified and matches a candidate, uses that interface.
    Otherwise returns the highest scoring active LAN interface.
    """
    candidates = scan_network_interfaces()
    
    if selected_ip:
        for c in candidates:
            if c["ip"] == selected_ip:
                return {
                    "ip": c["ip"],
                    "interface": c["interface"],
                    "network_type": c["network_type"],
                    "is_hotspot": c["is_hotspot"],
                    "is_connected": True,
                    "status_message": f"Using selected interface: {c['interface']}"
                }

    if candidates and candidates[0]["score"] > 0:
        c = candidates[0]
        return {
            "ip": c["ip"],
            "interface": c["interface"],
            "network_type": c["network_type"],
            "is_hotspot": c["is_hotspot"],
            "is_connected": True,
            "status_message": "Local network ready"
        }
    
    return {
        "ip": "127.0.0.1",
        "interface": "None",
        "network_type": "DISCONNECTED",
        "is_hotspot": False,
        "is_connected": False,
        "status_message": "Local connection unavailable. Connect this device and phone to the same Wi-Fi or mobile hotspot."
    }

def get_primary_lan_ip(selected_ip: Optional[str] = None) -> str:
    """Returns the single best IP address for generating the local connection URL."""
    info = get_primary_network_info(selected_ip)
    return info["ip"]

def get_local_lan_ips() -> List[str]:
    """
    Discovers all non-loopback IPv4 addresses assigned to the local device's network interfaces.
    Returns list of IP strings sorted with primary LAN address first.
    """
    candidates = scan_network_interfaces()
    if candidates:
        return [c["ip"] for c in candidates if c["score"] > -100]
    return ["127.0.0.1"]

def build_lan_endpoints(port: int) -> List[str]:
    """Constructs HTTP endpoints for discovered LAN IPs."""
    ips = get_local_lan_ips()
    return [f"http://{ip}:{port}" for ip in ips]

def verify_local_health(ip: str, port: int, timeout: float = 0.8) -> Dict[str, Any]:
    """
    Verifies that the server is running on 0.0.0.0 and responding to GET /health.
    Performs local reachability verification before generating the QR code.
    Tests both IP-specific reachability and localhost reachability to detect firewall blocks.
    """
    url = f"http://{ip}:{port}/health"
    localhost_url = f"http://127.0.0.1:{port}/health"

    # Step 1: Probe the LAN IP
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "QRDrop-HealthProbe/2.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return {
                    "reachable": True,
                    "serverListening": True,
                    "statusCode": 200,
                    "url": url,
                    "error": None,
                    "advisory": None
                }
    except Exception as lan_err:
        logger.warning(f"Health probe to {url} failed: {lan_err}")

    # Step 2: Probe localhost to see if server is running but LAN IP was blocked
    server_listening_locally = False
    try:
        req_local = urllib.request.Request(localhost_url, headers={"User-Agent": "QRDrop-HealthProbe/2.0"})
        with urllib.request.urlopen(req_local, timeout=0.5) as resp:
            if resp.status == 200:
                server_listening_locally = True
    except Exception:
        server_listening_locally = False

    # Also test TCP socket connectivity directly
    if not server_listening_locally:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                server_listening_locally = (s.connect_ex(("127.0.0.1", port)) == 0)
        except Exception:
            pass

    if server_listening_locally:
        return {
            "reachable": False,
            "serverListening": True,
            "statusCode": None,
            "url": url,
            "error": "Server is listening on 0.0.0.0, but LAN IP was unreachable from local probe.",
            "advisory": "Windows Firewall or network adapter isolation may be blocking inbound traffic on this port."
        }

    return {
        "reachable": False,
        "serverListening": False,
        "statusCode": None,
        "url": url,
        "error": f"Server is not responding on port {port}.",
        "advisory": "Start the QRDrop server and ensure it binds to 0.0.0.0."
    }

def get_network_diagnostics(port: int = 8000, selected_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Generates detailed diagnostics for the Developer Diagnostics panel and UI reachability checks.
    """
    candidates = scan_network_interfaces()
    primary = get_primary_network_info(selected_ip)
    health = verify_local_health(primary["ip"], port)

    # Detect firewall advisory status
    if health["reachable"]:
        firewall_status = "ALLOWING_CONNECTIONS"
        status_msg = "Reachable"
    elif health["serverListening"]:
        firewall_status = "CHECK_FIREWALL"
        status_msg = "Server running, but LAN IP not responding. Check Windows Firewall."
    else:
        firewall_status = "SERVER_OFFLINE"
        status_msg = "Server not responding on selected port."

    troubleshooting_tips = [
        "Ensure the phone and PC are connected to the EXACT same Wi-Fi network (turn off mobile data on phone).",
        "Wi-Fi AP Isolation: Many home/office routers isolate Wi-Fi devices. If ERR_ADDRESS_UNREACHABLE persists, connect both devices to a Phone Mobile Hotspot.",
        "Windows Firewall: Allow Python and port " + str(port) + " on Private and Public networks.",
        "Turn off any active VPNs on both the PC and the phone during local transfer."
    ]

    return {
        "status": "ready" if (primary["is_connected"] and health["serverListening"]) else "offline",
        "bindHost": "0.0.0.0",
        "interfaceName": primary["interface"],
        "primaryIp": primary["ip"],
        "port": port,
        "portListening": health["serverListening"],
        "isReachable": health["reachable"],
        "networkType": primary["network_type"],
        "isHotspot": primary["is_hotspot"],
        "statusMessage": status_msg,
        "protocolVersion": "QRDTP/1",
        "firewallStatus": firewall_status,
        "lanUrl": f"http://{primary['ip']}:{port}",
        "healthCheck": health,
        "troubleshootingTips": troubleshooting_tips,
        "candidateInterfaces": [
            {
                "interface": c["interface"],
                "ip": c["ip"],
                "networkType": c["network_type"],
                "isHotspot": c["is_hotspot"],
                "isUp": c["is_up"],
                "isVirtual": c["is_virtual"],
                "score": c["score"],
                "isDefaultRoute": c.get("is_default_route", False),
                "hasTraffic": c.get("has_traffic", False)
            }
            for c in candidates
        ]
    }

