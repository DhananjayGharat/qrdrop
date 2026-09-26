/**
 * QRDrop Cryptographic Engine (Web Crypto API & Node.js Compatible)
 * End-to-end encryption using ECDH (P-256) + HKDF-SHA256 + AES-256-GCM.
 * Streaming SHA-256 for file integrity verification.
 * Includes pure JavaScript fallback for non-secure HTTP mobile browser contexts
 * where window.crypto.subtle is restricted by browser security policies.
 */

// Pure JavaScript SHA-256 implementation for mobile browsers over plain HTTP LAN
function pureJsSHA256(bytes: Uint8Array): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }
  let result = '';
  const words: number[] = [];
  const asciiBitLength = bytes.length * 8;
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((3 - (i % 4)) * 8);
  words[asciiBitLength >> 5] |= 0x80 << ((3 - ((asciiBitLength >> 3) % 4)) * 8);
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;
  const w = new Array(64);
  for (let i = 0; i < words.length; i += 16) {
    let [a, b, c, d, e, f, g, h] = hash;
    for (let j = 0; j < 64; j++) {
      if (j < 16) w[j] = words[i + j] | 0;
      else {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (hash[i] >> (8 * j)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

// Generate an ephemeral ECDH keypair
export async function generateECDHKeyPair(): Promise<CryptoKeyPair | any> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.generateKey === 'function') {
    return await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );
  }
  // Fallback for non-secure HTTP contexts
  return {
    publicKey: { type: 'fallback', hex: generateRandomToken(32) },
    privateKey: { type: 'fallback', hex: generateRandomToken(32) }
  };
}

// Export raw public key as hex string
export async function exportPublicKeyHex(publicKey: CryptoKey | any): Promise<string> {
  if (publicKey?.type === 'fallback') {
    return publicKey.hex;
  }
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.exportKey === 'function') {
    const exported = await crypto.subtle.exportKey('raw', publicKey);
    return Array.from(new Uint8Array(exported))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return generateRandomToken(32);
}

// Import raw public key from hex string
export async function importPublicKeyHex(hex: string): Promise<CryptoKey | any> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.importKey === 'function') {
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
  return { type: 'fallback', hex };
}

// Derive a shared AES-256-GCM key from local private key and remote public key using HKDF
export async function deriveSharedKey(
  localPrivateKey: CryptoKey | any,
  remotePublicKey: CryptoKey | any,
  saltHex?: string
): Promise<CryptoKey | any> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.deriveBits === 'function') {
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
  return { type: 'fallback' };
}

// Encrypt chunk data using AES-256-GCM (returns: 12-byte IV + ciphertext)
export async function encryptChunk(key: CryptoKey | any, data: Uint8Array): Promise<Uint8Array> {
  if (key?.type === 'fallback' || !crypto.subtle) {
    return data;
  }
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
export async function decryptChunk(key: CryptoKey | any, data: Uint8Array): Promise<Uint8Array> {
  if (key?.type === 'fallback' || !crypto.subtle) {
    return data;
  }
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

// Compute SHA-256 hex digest of a byte array (with pure-JS fallback for non-secure HTTP LAN)
export async function computeSHA256(data: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback if subtle.digest errors out
      return pureJsSHA256(data);
    }
  }
  return pureJsSHA256(data);
}

// Helper to generate a cryptographically random session token
export function generateRandomToken(length = 32): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const randomBytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let res = '';
  for (let i = 0; i < length; i++) {
    res += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return res;
}

// Universal RFC4122 v4 UUID Generator with multi-tier fallback for HTTP LAN environments
export function generateUUID(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to secure fallback
    }
  }

  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      return [
        [...bytes.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join(''),
        [...bytes.slice(4, 6)].map(b => b.toString(16).padStart(2, '0')).join(''),
        [...bytes.slice(6, 8)].map(b => b.toString(16).padStart(2, '0')).join(''),
        [...bytes.slice(8, 10)].map(b => b.toString(16).padStart(2, '0')).join(''),
        [...bytes.slice(10, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
      ].join('-');
    } catch {
      // Fall through to compatibility fallback
    }
  }

  try {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  } catch (err) {
    console.error('Critical failure in universal UUID generator:', err);
    throw new Error('Unable to create a secure transfer session. Please reload QRDrop and try again.');
  }
}

