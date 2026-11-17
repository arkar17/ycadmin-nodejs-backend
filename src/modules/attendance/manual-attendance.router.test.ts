import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AttendanceSource, Status } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { AttendanceRepository } from './attendance.repository.js';
import type { ManualAttendanceRepository } from './manual-attendance.repository.js';
import { createAttendanceRouter } from './attendance.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (claims: object) => jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: '1h' });
const identity = (permissionNames = ['attendance:create']): AdminIdentityRepository => ({ findActiveAdminById: vi.fn(async () => ({ id: 7, displayName: 'Admin', roleNames: [], permissionNames })) });
const listRepo: AttendanceRepository = { findPage: vi.fn(async () => ({ records: [], total: 0 })) };
const member = { id: 11, name: 'Manual Member', code: 'MAN-011', status: Status.ACTIVE };
const manualRepo = (options?: { member?: typeof member | null; conflict?: boolean }): ManualAttendanceRepository => ({ findMemberById: vi.fn(async () => options?.member === undefined ? member : options.member), create: vi.fn(async () => { if (options?.conflict) { const error = new Error('ATTENDANCE_RECENTLY_RECORDED'); Object.assign(error, { cause: { code: 'P0001' } }); throw error; } return { id: 3, createdAt: new Date('2026-10-10T10:00:00.000Z'), date: '2026-10-10', source: AttendanceSource.MANUAL, qrToken: null, createdById: 7, member: { id: 11, name: 'Manual Member', code: 'MAN-011' } }; }) });
const app = (repository = manualRepo(), auth = identity()) => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/attendance', createAttendanceRouter({ adminIdentityRepository: auth, attendanceRepository: listRepo, manualAttendanceRepository: repository })); value.use(errorHandler); return value; };
const adminHeaders = () => ({ Authorization: `Bearer ${token({ id: 7, loginType: 'admin' })}` });

describe('Manual Attendance router', () => {
  it('requires attendance:create and returns a minimal manual DTO without QR data', async () => { const response = await request(app()).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 11 }); const denied = await request(app(manualRepo(), identity([]))).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 11 }); expect(response.status).toBe(201); expect(response.body.data).toEqual({ id: 3, checkedInAt: '2026-10-10T10:00:00.000Z', recordedDate: '2026-10-10', source: 'MANUAL', member: { id: 11, name: 'Manual Member', clientCode: 'MAN-011' } }); expect(JSON.stringify(response.body)).not.toContain('qrToken'); expect(denied.status).toBe(403); });
  it('rejects absent/wrong-type authentication, invalid IDs, and unknown body fields', async () => { const missing = await request(app()).post('/api/admin/v1/attendance/manual').send({ memberId: 11 }); const memberToken = await request(app()).post('/api/admin/v1/attendance/manual').set('Authorization', `Bearer ${token({ id: 7, loginType: 'member' })}`).send({ memberId: 11 }); const invalid = await request(app()).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 0 }); const unknown = await request(app()).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 11, qrToken: 'forbidden' }); expect(missing.status).toBe(401); expect(memberToken.status).toBe(401); expect(invalid.status).toBe(422); expect(unknown.status).toBe(422); });
  it('maps missing/inactive members and database rolling conflicts safely', async () => { const missing = await request(app(manualRepo({ member: null }))).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 11 }); const inactive = await request(app(manualRepo({ member: { ...member, status: Status.INACTIVE } }))).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 11 }); const conflict = await request(app(manualRepo({ conflict: true }))).post('/api/admin/v1/attendance/manual').set(adminHeaders()).send({ memberId: 11 }); expect(missing.body.error.code).toBe('MEMBER_NOT_FOUND'); expect(inactive.body.error.code).toBe('MEMBER_INACTIVE'); expect(conflict).toHaveProperty('status', 409); expect(conflict.body.error.code).toBe('ATTENDANCE_RECENTLY_RECORDED'); });
});
