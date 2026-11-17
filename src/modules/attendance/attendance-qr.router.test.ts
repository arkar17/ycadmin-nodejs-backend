import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { AppError } from '../../shared/app-error.js';
import type { AttendanceQrCredentialOperations } from './attendance-qr-credential.service.js';
import { createAttendanceQrRouter } from './attendance-qr.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (claims: object, options?: jwt.SignOptions) => jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: '1h', ...options });
const identity = (permissions: string[] = ['attendance-qr:create', 'attendance-qr:read']): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 7, displayName: 'QR Admin', roleNames: ['Synthetic role'], permissionNames: permissions })),
});
const credential = { id: 4, payload: 'opaque-printable-payload', createdAt: new Date('2026-10-31T00:00:00.000Z') };
const service = (options?: { createError?: AppError; readError?: AppError }): AttendanceQrCredentialOperations => ({
  create: vi.fn(async () => { if (options?.createError) throw options.createError; return credential; }),
  retrieve: vi.fn(async () => { if (options?.readError) throw options.readError; return credential; }),
});
const app = (credentials = service(), adminIdentity = identity()) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/attendance/qr', createAttendanceQrRouter({ adminIdentityRepository: adminIdentity, credentialService: credentials }));
  value.use(errorHandler);
  return value;
};
const headers = () => ({ Authorization: `Bearer ${token({ id: 7, loginType: 'admin' })}` });

describe('Attendance QR management router', () => {
  it('creates once and retrieves the same printable payload with no-store responses', async () => {
    const credentials = service();
    const first = await request(app(credentials)).post('/api/admin/v1/attendance/qr').set(headers());
    const read = await request(app(credentials)).get('/api/admin/v1/attendance/qr').set(headers());
    expect(first.status).toBe(201);
    expect(read.status).toBe(200);
    expect(first.body.data).toEqual({ credentialId: 4, qrPayload: credential.payload, createdAt: '2026-10-31T00:00:00.000Z' });
    expect(read.body.data).toEqual(first.body.data);
    expect(first.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(first.body)).not.toContain('payloadFingerprint');
    expect(credentials.create).toHaveBeenCalledWith(7);
  });

  it('requires separate QR permissions, valid Admin JWTs, and an active resolved identity', async () => {
    const noAuth = await request(app()).get('/api/admin/v1/attendance/qr');
    const member = await request(app()).get('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token({ id: 7, loginType: 'member' })}`);
    const expired = await request(app()).get('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token({ id: 7, loginType: 'admin' }, { expiresIn: -1 })}`);
    const noRead = await request(app(service(), identity(['attendance-qr:create']))).get('/api/admin/v1/attendance/qr').set(headers());
    const noCreate = await request(app(service(), identity(['attendance-qr:read']))).post('/api/admin/v1/attendance/qr').set(headers()).send({});
    const inactive = await request(app(service(), { findActiveAdminById: vi.fn(async () => null) })).get('/api/admin/v1/attendance/qr').set(headers());
    expect([noAuth.status, member.status, expired.status, inactive.status]).toEqual([401, 401, 401, 401]);
    expect([noRead.status, noCreate.status]).toEqual([403, 403]);
  });

  it('rejects unexpected POST input and returns stable credential errors without crypto details', async () => {
    const invalid = await request(app()).post('/api/admin/v1/attendance/qr').set(headers()).send({ replace: true });
    const exists = await request(app(service({ createError: new AppError({ statusCode: 409, code: 'QR_ALREADY_EXISTS', message: 'An active attendance QR credential already exists.' }) }))).post('/api/admin/v1/attendance/qr').set(headers()).send({});
    const missing = await request(app(service({ readError: new AppError({ statusCode: 404, code: 'QR_NOT_CONFIGURED', message: 'No active attendance QR credential exists.' }) }))).get('/api/admin/v1/attendance/qr').set(headers());
    const unavailable = await request(app(service({ readError: new AppError({ statusCode: 503, code: 'QR_CREDENTIAL_UNAVAILABLE', message: 'The attendance QR credential is temporarily unavailable.' }) }))).get('/api/admin/v1/attendance/qr').set(headers());
    expect(invalid.status).toBe(422);
    expect(exists.body.error.code).toBe('QR_ALREADY_EXISTS');
    expect(missing.body.error.code).toBe('QR_NOT_CONFIGURED');
    expect(unavailable.body.error.code).toBe('QR_CREDENTIAL_UNAVAILABLE');
    expect(JSON.stringify(unavailable.body)).not.toMatch(/aes|gcm|cipher|fingerprint/i);
  });
});
