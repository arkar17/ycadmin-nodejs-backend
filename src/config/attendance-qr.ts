import type { AttendanceQrCredentialCrypto } from '../modules/attendance/attendance-qr-credential.service.js';
import { env } from './env.js';

const decodeBase64Key = (name: string, value: string, minimumLength: number): Buffer => {
  // Do not accept permissive Buffer decoding: malformed secret configuration
  // must not silently produce weak or unintended key bytes.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${name} must be canonical base64.`);
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < minimumLength || decoded.toString('base64') !== value) {
    throw new Error(`${name} must be canonical base64 with at least ${minimumLength} bytes.`);
  }

  return decoded;
};

/**
 * Reads QR encryption material from the process environment only. Database
 * rows contain encrypted payloads and fingerprints, never these key bytes.
 */
export const attendanceQrCryptoFromEnvironment = (): AttendanceQrCredentialCrypto | null => {
  const encryption = env.ATTENDANCE_QR_ENCRYPTION_KEY;
  const hmac = env.ATTENDANCE_QR_HMAC_KEY;

  if (!encryption && !hmac) return null;
  if (!encryption || !hmac) {
    throw new Error('ATTENDANCE_QR_ENCRYPTION_KEY and ATTENDANCE_QR_HMAC_KEY must be configured together.');
  }

  const encryptionKey = decodeBase64Key('ATTENDANCE_QR_ENCRYPTION_KEY', encryption, 32);
  if (encryptionKey.length !== 32) {
    throw new Error('ATTENDANCE_QR_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM.');
  }

  return { encryptionKey, hmacKey: decodeBase64Key('ATTENDANCE_QR_HMAC_KEY', hmac, 32) };
};
