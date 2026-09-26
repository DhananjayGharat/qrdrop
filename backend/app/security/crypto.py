import os
import hashlib
from typing import Tuple
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

def generate_ecdh_keypair() -> Tuple[ec.EllipticCurvePrivateKey, str]:
    """Generates an ephemeral ECDH SECP256R1 keypair and returns (private_key, public_key_hex)."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    pub_bytes = public_key.public_bytes(
        encoding=Encoding.X962,
        format=PublicFormat.UncompressedPoint
    )
    return private_key, pub_bytes.hex()

def derive_aes_gcm_key(private_key: ec.EllipticCurvePrivateKey, peer_public_key_hex: str, salt: bytes | None = None) -> bytes:
    """
    Derives a 256-bit AES-GCM symmetric key from ECDH shared secret using HKDF-SHA256.
    Matches Web Crypto API deriveKey parameters.
    """
    peer_bytes = bytes.fromhex(peer_public_key_hex)
    peer_public_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), peer_bytes)
    shared_secret = private_key.exchange(ec.ECDH(), peer_public_key)

    if salt is None:
        salt = b"QRDrop-v1-Salt"

    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        info=b"QRDrop-Transfer-Key"
    )
    return hkdf.derive(shared_secret)

def encrypt_chunk(key: bytes, plaintext: bytes) -> bytes:
    """Encrypts chunk bytes using AES-256-GCM with a 12-byte random IV. Returns IV + ciphertext + tag."""
    aesgcm = AESGCM(key)
    iv = os.urandom(12)
    ciphertext = aesgcm.encrypt(iv, plaintext, None)
    return iv + ciphertext

def decrypt_chunk(key: bytes, payload: bytes) -> bytes:
    """Decrypts chunk bytes using AES-256-GCM. Expects 12-byte IV prepended to ciphertext + tag."""
    if len(payload) < 28:
        raise ValueError("Encrypted chunk payload is too short.")
    iv = payload[:12]
    ciphertext = payload[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(iv, ciphertext, None)

def calculate_sha256_file(filepath: str, chunk_size: int = 1024 * 1024) -> str:
    """Computes streaming SHA-256 hex digest of a file on disk without loading entire file into RAM."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()

def calculate_sha256_bytes(data: bytes) -> str:
    """Computes SHA-256 hex digest of in-memory bytes."""
    return hashlib.sha256(data).hexdigest()
