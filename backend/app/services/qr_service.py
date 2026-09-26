import qrcode
import io
import base64
import json
from typing import Dict, Any

def generate_qr_data_uri(payload_data: Dict[str, Any] | str) -> str:
    """
    Generates a base64 encoded PNG data URI for a given payload (JSON or string).
    Configures high error correction (Level M or Q) for fast scanning.
    """
    if isinstance(payload_data, dict):
        text_content = json.dumps(payload_data, separators=(',', ':'))
    else:
        text_content = str(payload_data)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=3,
    )
    qr.add_data(text_content)
    qr.make(fit=True)

    img = qr.make_image(fill_color="#0F172A", back_color="#FFFFFF")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"
