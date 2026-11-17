import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AttendanceQrCredentialService } from './attendance-qr-credential.service.js';
import { createAttendanceQrRouter } from './attendance-qr.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id: number, loginType = 'admin') => jwt.sign({ id, loginType }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const localKeys = () => ({ encryptionKey: Buffer.alloc(32, 83), hmacKey: Buffer.alloc(32, 97) });
const app = () => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/attendance/qr', createAttendanceQrRouter({ adminIdentityRepository: new PrismaAdminIdentityRepository(), credentialService: new AttendanceQrCredentialService(localKeys()) })); value.use(errorHandler); return value; };
const isolated = () => { const url = new URL(process.env.DATABASE_URL ?? ''); if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.'); };
type Fixture = { adminId: number; inactiveAdminId: number; roleId: number; createPermissionId: number; readPermissionId: number };
const seed = async (): Promise<Fixture> => { isolated(); const prisma = getPrismaClient(); await prisma.$executeRawUnsafe('TRUNCATE TABLE "AttendanceQrCredential", "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE'); const [createPermission, readPermission] = await Promise.all([prisma.permission.create({ data: { name: 'attendance-qr:create', description: 'Synthetic isolated-test QR creation permission' } }), prisma.permission.create({ data: { name: 'attendance-qr:read', description: 'Synthetic isolated-test QR read permission' } })]); const role = await prisma.role.create({ data: { name: 'Synthetic Attendance QR Role' } }); await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: createPermission.id }, { roleId: role.id, permissionId: readPermission.id }] }); const admin = await prisma.user.create({ data: { name: 'QR Admin', email: 'qr.admin@example.test', username: 'qr-admin', password: 'hash' } }); const inactive = await prisma.user.create({ data: { name: 'Inactive QR Admin', email: 'inactive.qr.admin@example.test', username: 'inactive-qr-admin', password: 'hash', status: Status.INACTIVE } }); await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: role.id }, { userId: inactive.id, roleId: role.id }] }); return { adminId: admin.id, inactiveAdminId: inactive.id, roleId: role.id, createPermissionId: createPermission.id, readPermissionId: readPermission.id }; };

describe('Attendance QR management isolated PostgreSQL integration', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await seed(); });
  afterAll(async () => { await disconnectDatabase(); });

  it('persists one encrypted credential and returns the exact same payload on GET after a fresh service instance', async () => {
    const created = await request(app()).post('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({});
    const retrieved = await request(app()).get('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`);
    expect(created.status).toBe(201); expect(retrieved.status).toBe(200); expect(retrieved.body.data).toEqual(created.body.data); expect(created.headers['cache-control']).toContain('no-store');
    const stored = await getPrismaClient().attendanceQrCredential.findUniqueOrThrow({ where: { id: created.body.data.credentialId } });
    expect(stored.createdById).toBe(fixture.adminId);
    expect(Buffer.from(stored.payloadCiphertext).toString('utf8')).not.toBe(created.body.data.qrPayload);
    expect(JSON.stringify(created.body)).not.toMatch(/payloadFingerprint|payloadCiphertext|payloadIv|payloadAuthTag/);
  });

  it('allows exactly one active credential, preserves the manual route contract, and rejects missing credentials', async () => {
    const first = await request(app()).post('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({});
    const duplicate = await request(app()).post('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({});
    expect(first.status).toBe(201); expect(duplicate.status).toBe(409); expect(duplicate.body.error.code).toBe('QR_ALREADY_EXISTS');
    fixture = await seed();
    const absent = await request(app()).get('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`);
    expect(absent.status).toBe(404); expect(absent.body.error.code).toBe('QR_NOT_CONFIGURED');
  });

  it('maps concurrent initial creation to one success and one QR_ALREADY_EXISTS conflict', async () => {
    const responses = await Promise.all([
      request(app()).post('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({}),
      request(app()).post('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({}),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe('QR_ALREADY_EXISTS');
  });

  it('enforces active users and database-backed independently revocable permissions', async () => {
    const inactive = await request(app()).get('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    await getPrismaClient().rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.roleId, permissionId: fixture.readPermissionId } } });
    const noRead = await request(app()).get('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`);
    await getPrismaClient().rolePermission.create({ data: { roleId: fixture.roleId, permissionId: fixture.readPermissionId } });
    await getPrismaClient().rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.roleId, permissionId: fixture.createPermissionId } } });
    const noCreate = await request(app()).post('/api/admin/v1/attendance/qr').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({});
    expect(inactive.status).toBe(401); expect(noRead.status).toBe(403); expect(noCreate.status).toBe(403);
  });
});
