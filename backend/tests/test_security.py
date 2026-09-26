import pytest
import time
from pathlib import Path
from backend.app.security.tokens import TokenManager
from backend.app.security.sanitizer import (
    sanitize_filename,
    sanitize_relative_path,
    resolve_safe_destination_path,
    PathTraversalError,
    InvalidFileNameError
)
from backend.app.security.crypto import (
    generate_ecdh_keypair,
    derive_aes_gcm_key,
    encrypt_chunk,
    decrypt_chunk,
    calculate_sha256_bytes
)

def test_token_expiration_and_replay_protection():
    tm = TokenManager(default_ttl_seconds=1)
    session_id = "test-session-123"
    token, exp = tm.generate_token(session_id, ttl_seconds=1)
    
    # 1. Valid token succeeds once
    assert tm.validate_and_consume(token, session_id) is True
    
    # 2. Replay attack: reusing the same token MUST fail!
    assert tm.validate_and_consume(token, session_id) is False
    
    # 3. Wrong session ID MUST fail
    token2, _ = tm.generate_token("session-A", ttl_seconds=10)
    assert tm.validate_and_consume(token2, "session-B") is False
    
    # 4. Expired token MUST fail
    token3, _ = tm.generate_token("session-C", ttl_seconds=0.05)
    time.sleep(0.1)
    assert tm.validate_and_consume(token3, "session-C") is False

def test_path_traversal_attacks_blocked(tmp_path):
    dest_dir = tmp_path / "downloads"
    dest_dir.mkdir()

    # Attack 1: Unix dot-dot escape
    with pytest.raises(PathTraversalError):
        resolve_safe_destination_path(dest_dir, "../../etc", "passwd")

    # Attack 2: Windows backslash dot-dot escape
    with pytest.raises(PathTraversalError):
        resolve_safe_destination_path(dest_dir, "..\\..\\Windows\\System32", "calc.exe")

    # Attack 3: Absolute Windows drive path
    target = resolve_safe_destination_path(dest_dir, "C:\\Windows", "malicious.exe")
    assert dest_dir in target.parents
    assert "C:" not in str(target.relative_to(dest_dir))

    # Attack 4: Nested traversal inside subfolder
    with pytest.raises(PathTraversalError):
        resolve_safe_destination_path(dest_dir, "photos/../../secret", "key.pem")

def test_filename_sanitization():
    assert sanitize_filename("my photo.png") == "my photo.png"
    assert sanitize_filename("../evil.sh") == "evil.sh"
    assert sanitize_filename("CON.txt").startswith("safe_")
    assert sanitize_filename("test\0injection.txt") == "testinjection.txt"

def test_e2e_ecdh_aes_gcm_crypto_roundtrip():
    # Peer A generates keypair
    priv_a, pub_a_hex = generate_ecdh_keypair()
    # Peer B generates keypair
    priv_b, pub_b_hex = generate_ecdh_keypair()

    # Both derive shared symmetric key
    key_a = derive_aes_gcm_key(priv_a, pub_b_hex)
    key_b = derive_aes_gcm_key(priv_b, pub_a_hex)

    assert key_a == key_b, "Derived AES-GCM keys must be identical on both peers!"

    # Encrypt chunk with Peer A's key
    sample_plaintext = b"QRDrop high-speed chunk encryption payload 1234567890"
    encrypted_payload = encrypt_chunk(key_a, sample_plaintext)

    # Decrypt chunk with Peer B's key
    decrypted_plaintext = decrypt_chunk(key_b, encrypted_payload)
    assert decrypted_plaintext == sample_plaintext

    # Corrupted ciphertext must fail to decrypt
    corrupt_payload = bytearray(encrypted_payload)
    corrupt_payload[-1] ^= 0xFF
    with pytest.raises(Exception):
        decrypt_chunk(key_b, bytes(corrupt_payload))
