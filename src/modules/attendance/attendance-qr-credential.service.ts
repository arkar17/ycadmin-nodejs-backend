import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AttendanceQrCredentialStatus, Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';
import { AppError } from '../../shared/app-error.js';

export type AttendanceQrCredentialCrypto = { encryptionKey: Buffer; hmacKey: Buffer };
export type AttendanceQrCredentialValue = { id: number; payload: string; createdAt: Date };
export interface AttendanceQrCredentialOperations {
  create(actorId: number): Promise<AttendanceQrCredentialValue>;
  retrieve(): Promise<AttendanceQrCredentialValue>;
}
type PrismaBytes = Uint8Array<ArrayBuffer>;
const prismaBytes = (value: Uint8Array): PrismaBytes => { const copied = new Uint8Array(value.byteLength); copied.set(value); return copied; };

const activeConflict = () => new AppError({ statusCode: 409, code: 'QR_ALREADY_EXISTS', message: 'An active attendance QR credential already exists.' });
const missingCredential = () => new AppError({ statusCode: 404, code: 'QR_NOT_CONFIGURED', message: 'No active attendance QR credential exists.' });
const unavailableCredential = () => new AppError({ statusCode: 503, code: 'QR_CREDENTIAL_UNAVAILABLE', message: 'The attendance QR credential is temporarily unavailable.' });

/**
 * Persistence-only foundation. No HTTP route calls this service in Stage 3A.
 * Production keys must come from an approved secret manager, never a database row.
 */
export class AttendanceQrCredentialService implements AttendanceQrCredentialOperations {
  public constructor(private readonly crypto: AttendanceQrCredentialCrypto) {
    if (crypto.encryptionKey.length !== 32 || crypto.hmacKey.length < 32) throw new Error('Attendance QR credential keys are invalid.');
  }

  public async create(actorId: number): Promise<AttendanceQrCredentialValue> {
    return this.createNew(actorId, false);
  }

  public async retrieve(): Promise<AttendanceQrCredentialValue> {
    const credential = await getPrismaClient().attendanceQrCredential.findFirst({ where: { status: AttendanceQrCredentialStatus.ACTIVE }, select: { id: true, payloadCiphertext: true, payloadIv: true, payloadAuthTag: true, createdAt: true } });
    if (!credential) throw missingCredential();
    return { id: credential.id, payload: this.decrypt(credential.payloadCiphertext, credential.payloadIv, credential.payloadAuthTag), createdAt: credential.createdAt };
  }

  public async replace(actorId: number): Promise<AttendanceQrCredentialValue> {
    return this.createNew(actorId, true);
  }

  public async revoke(actorId: number): Promise<void> {
    await getPrismaClient().$transaction(async (transaction) => {
      const active = await transaction.attendanceQrCredential.findFirst({ where: { status: AttendanceQrCredentialStatus.ACTIVE }, select: { id: true } });
      if (!active) throw missingCredential();
      await transaction.attendanceQrCredential.update({ where: { id: active.id }, data: { status: AttendanceQrCredentialStatus.REVOKED, revokedById: actorId, revokedAt: new Date() } });
    });
  }

  public async verifies(payload: string): Promise<boolean> {
    const fingerprint = this.fingerprint(payload);
    const credential = await getPrismaClient().attendanceQrCredential.findFirst({ where: { status: AttendanceQrCredentialStatus.ACTIVE, payloadFingerprint: fingerprint }, select: { payloadCiphertext: true, payloadIv: true, payloadAuthTag: true } });
    if (!credential) return false;
    const stored = Buffer.from(this.decrypt(credential.payloadCiphertext, credential.payloadIv, credential.payloadAuthTag));
    const supplied = Buffer.from(payload);
    return stored.length === supplied.length && timingSafeEqual(stored, supplied);
  }

  private async createNew(actorId: number, replace: boolean): Promise<AttendanceQrCredentialValue> {
    const payload = randomBytes(32).toString('base64url');
    const encrypted = this.encrypt(payload); const fingerprint = this.fingerprint(payload);
    try {
      const result = await getPrismaClient().$transaction(async (transaction) => {
        const active = await transaction.attendanceQrCredential.findFirst({ where: { status: AttendanceQrCredentialStatus.ACTIVE }, select: { id: true } });
        if (active && !replace) throw activeConflict();
        if (active) await transaction.attendanceQrCredential.update({ where: { id: active.id }, data: { status: AttendanceQrCredentialStatus.REPLACED, replacedById: actorId, replacedAt: new Date() } });
        return transaction.attendanceQrCredential.create({ data: { status: AttendanceQrCredentialStatus.ACTIVE, payloadCiphertext: encrypted.ciphertext, payloadIv: encrypted.iv, payloadAuthTag: encrypted.authTag, payloadFingerprint: fingerprint, createdById: actorId }, select: { id: true, createdAt: true } });
      });
      return { id: result.id, payload, createdAt: result.createdAt };
    } catch (error) {
      if (this.isActiveCredentialUniqueConflict(error)) throw activeConflict();
      throw error;
    }
  }

  private isActiveCredentialUniqueConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return true;
    const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
    const code = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
    const constraint = cause && typeof cause === 'object' && 'constraint' in cause ? (cause as { constraint?: unknown }).constraint : undefined;
    // Prisma's driver adapter can preserve native PostgreSQL errors rather than
    // wrapping them in P2002. Map only the named one-active partial index.
    return code === '23505' && constraint === 'AttendanceQrCredential_one_active_key';
  }

  private fingerprint(payload: string): PrismaBytes { return prismaBytes(createHmac('sha256', this.crypto.hmacKey).update(payload, 'utf8').digest()); }
  private encrypt(payload: string): { ciphertext: PrismaBytes; iv: PrismaBytes; authTag: PrismaBytes } { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.crypto.encryptionKey, iv); return { ciphertext: prismaBytes(Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])), iv: prismaBytes(iv), authTag: prismaBytes(cipher.getAuthTag()) }; }
  private decrypt(ciphertext: Uint8Array, iv: Uint8Array, authTag: Uint8Array): string {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.crypto.encryptionKey, Buffer.from(iv));
      decipher.setAuthTag(Buffer.from(authTag));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString('utf8');
    } catch {
      throw unavailableCredential();
    }
  }
}

/** Fails closed when approved secret-manager material has not been supplied. */
export class UnavailableAttendanceQrCredentialService implements AttendanceQrCredentialOperations {
  public async create(_actorId: number): Promise<AttendanceQrCredentialValue> { throw unavailableCredential(); }
  public async retrieve(): Promise<AttendanceQrCredentialValue> { throw unavailableCredential(); }
}
