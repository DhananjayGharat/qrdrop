/**
 * QRDrop Cryptographic Engine (Web Crypto API & Node.js Compatible)
 * End-to-end encryption using ECDH (P-256) + HKDF-SHA256 + AES-256-GCM.
 * Streaming SHA-256 for file integrity verification.
 */

// Generate an ephemeral ECDH keypair
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

// Export raw public key as hex string
export async function exportPublicKeyHex(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', publicKey);
  return Array.from(new Uint8Array(exported))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Import raw public key from hex string
export async function importPublicKeyHex(hex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  return await crypto.subtle.importKey(
    'raw',
    bytes,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

// Derive a shared AES-256-GCM key from local private key and remote public key using HKDF
export async function deriveSharedKey(
  localPrivateKey: CryptoKey,
  remotePublicKey: CryptoKey,
  saltHex?: string
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: remotePublicKey,
    },
    localPrivateKey,
    256
  );

  const saltBytes = saltHex
    ? new Uint8Array(saltHex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || [])
    : new TextEncoder().encode('QRDrop-v1-Salt');

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: new TextEncoder().encode('QRDrop-Transfer-Key'),
    },
    hkdfKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt chunk data using AES-256-GCM (returns: 12-byte IV + ciphertext)
export async function encryptChunk(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    key,
    data as any
  );

  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

// Decrypt chunk data using AES-256-GCM (input: 12-byte IV + ciphertext)
export async function decryptChunk(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 12 + 16) {
    throw new Error('Ciphertext too short');
  }
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    key,
    ciphertext as any
  );

  return new Uint8Array(decrypted);
}

// Compute SHA-256 hex digest of a byte array
export async function computeSHA256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to generate a cryptographically random session token
export function generateRandomToken(length = 32): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
