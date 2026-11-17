// Proposed new file:
// app/services/member/v1/fitness/attendance-qr-credential.service.ts
// REVIEW ONLY — uses no QR payload in errors/logs.

import { createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";
import { AttendanceQrCredentialStatus } from "@prisma/client";
import prisma from "../../../../../prisma/client";
import { Exception, exceptionMessages, statusCodes } from "../../../../helpers/exceptions";

type QrCrypto = { encryptionKey: Buffer; hmacKey: Buffer };

const unavailable = () => new Exception(
  statusCodes.SERVICE_UNAVAILABLE,
  "QR check-in is temporarily unavailable.",
  exceptionMessages.serviceUnavailable,
);

const decodeCanonicalBase64 = (value: string | undefined, exactLength?: number): Buffer => {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw unavailable();
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < 32 || decoded.toString("base64") !== value || (exactLength && decoded.length !== exactLength)) throw unavailable();
  return decoded;
};

const cryptoFromEnvironment = (): QrCrypto => ({
  encryptionKey: decodeCanonicalBase64(process.env.ATTENDANCE_QR_ENCRYPTION_KEY, 32),
  hmacKey: decodeCanonicalBase64(process.env.ATTENDANCE_QR_HMAC_KEY),
});

/** Verifies only the active permanent credential; it never returns the payload. */
export class AttendanceQrCredentialService {
  public async verifies(payload: string): Promise<boolean> {
    const crypto = cryptoFromEnvironment();
    const fingerprint = createHmac("sha256", crypto.hmacKey).update(payload, "utf8").digest();
    const credential = await prisma.attendanceQrCredential.findFirst({
      where: { status: AttendanceQrCredentialStatus.ACTIVE, payloadFingerprint: fingerprint },
      select: { payloadCiphertext: true, payloadIv: true, payloadAuthTag: true },
    });

    if (!credential) return false;

    try {
      const decipher = createDecipheriv("aes-256-gcm", crypto.encryptionKey, Buffer.from(credential.payloadIv));
      decipher.setAuthTag(Buffer.from(credential.payloadAuthTag));
      const stored = Buffer.concat([
        decipher.update(Buffer.from(credential.payloadCiphertext)),
        decipher.final(),
      ]);
      const supplied = Buffer.from(payload, "utf8");
      return stored.length === supplied.length && timingSafeEqual(stored, supplied);
    } catch {
      // Ciphertext/key failures are operational failures, not an invalid-user
      // signal. The caller returns the fixed service-unavailable JSON-RPC body.
      throw unavailable();
    }
  }
}
