import socket
import logging

logger = logging.getLogger("qrdrop.port_manager")

def is_port_available(port: int, host: str = "0.0.0.0") -> bool:
    """
    Checks if a port is available for binding.
    Uses exclusive address use on Windows to prevent false positives when another process is listening.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, port))
            return True
        except OSError:
            return False

def find_available_port(preferred_port: int = 8000, max_attempts: int = 50) -> int:
    """
    Finds the first available port starting from preferred_port.
    If preferred_port is taken (e.g. 8000), checks 8001, 8002, 8080, etc.
    """
    for p in range(preferred_port, preferred_port + max_attempts):
        if is_port_available(p):
            if p != preferred_port:
                logger.info(f"Preferred port {preferred_port} was in use. Selected available port {p}.")
            return p

    # Fallback to ephemeral port from OS
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        ephemeral = s.getsockname()[1]
        logger.warning(f"Could not find port in range {preferred_port}-{preferred_port+max_attempts}. Using OS port {ephemeral}.")
        return ephemeral
