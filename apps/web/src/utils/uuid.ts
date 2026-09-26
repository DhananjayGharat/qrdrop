/**
 * Universal RFC4122 v4 UUID Generator
 * Compatible with all browser environments, including non-secure HTTP LAN contexts
 * (e.g., http://192.168.x.x:8000) where window.crypto.randomUUID is undefined.
 *
 * Hierarchy:
 * 1. crypto.randomUUID() [Secure context / modern browser]
 * 2. crypto.getRandomValues() [RFC4122 v4 cryptographically random bytes - works in non-secure HTTP]
 * 3. Math.random() [Last-resort fallback]
 */

export function generateUUID(): string {
  // 1. Native crypto.randomUUID (available in Secure Contexts: localhost, HTTPS)
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

  // 2. Cryptographically secure PRNG via getRandomValues (available on HTTP LAN in all modern browsers)
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);

      // Set RFC4122 version to 4 (0100xxxx)
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      // Set variant to RFC4122 (10xxxxxx)
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

  // 3. Last-resort compatibility fallback
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
