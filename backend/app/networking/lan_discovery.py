import socket
from typing import List

def get_local_lan_ips() -> List[str]:
    """
    Discovers all non-loopback IPv4 addresses assigned to the local device's network interfaces.
    Returns list of IP strings.
    """
    ips = set()
    try:
        # Standard UDP socket trick: connects to an external address without sending packets
        # to determine which interface the OS routes through.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # Using Google Public DNS IP as routing target
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if primary_ip and not primary_ip.startswith("127."):
            ips.add(primary_ip)
    except Exception:
        pass

    try:
        # Also inspect host by name
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127.") and ":" not in ip:
                ips.add(ip)
    except Exception:
        pass

    # Sort so that common private subnets (192.168, 10., 172.) come first
    sorted_ips = sorted(
        list(ips),
        key=lambda ip: (
            0 if ip.startswith("192.168.") else
            1 if ip.startswith("10.") else
            2 if ip.startswith("172.") else 3
        )
    )
    return sorted_ips if sorted_ips else ["127.0.0.1"]

def build_lan_endpoints(port: int) -> List[str]:
    """Constructs HTTP endpoints for discovered LAN IPs."""
    ips = get_local_lan_ips()
    return [f"http://{ip}:{port}" for ip in ips]
