import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { DashboardAggregate, DashboardRepository } from './dashboard.repository.js';
import { createDashboardRouter } from './dashboard.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const aggregate: DashboardAggregate = {
  totalRegistered: 10, activeRegistered: 7, inactiveRegistered: 3, newRegistered: 2,
  attendanceRecords: 4, distinctAttendanceMembers: 3,
  pendingRequests: 5, approvedRequests: 6, rejectedRequests: 1, newRequests: 2,
};

const identity = (permissions: string[]): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Dashboard Admin', roleNames: ['Synthetic'], permissionNames: permissions })),
});

const repository = (trendValues = [{ bucket: '2026-02-02', registrations: 2, attendance: 4, membershipRequests: 2 }]): DashboardRepository => ({
  aggregate: vi.fn(async () => aggregate),
  trends: vi.fn(async () => trendValues),
});

const app = (repo = repository(), permissions = ['dashboard:read']) => {
  const value = express();
  value.use('/api/admin/v1/dashboard', createDashboardRouter({ adminIdentityRepository: identity(permissions), dashboardRepository: repo }));
  value.use(errorHandler);
  return value;
};

const auth = { Authorization: `Bearer ${jwt.sign({ id: 1, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' })}` };

describe('Dashboard overview router', () => {
  it('requires current Admin authentication and the proposed dashboard:read permission', async () => {
    expect((await request(app()).get('/api/admin/v1/dashboard/overview?month=2026-02')).status).toBe(401);
    expect((await request(app(repository(), [])).get('/api/admin/v1/dashboard/overview?month=2026-02').set(auth)).status).toBe(403);
  });

  it('returns month metrics with Yangon UTC boundaries and zero-filled daily trends', async () => {
    const repo = repository();
    const response = await request(app(repo)).get('/api/admin/v1/dashboard/overview?month=2026-02').set(auth);
    expect(response.status).toBe(200);
    expect(response.body.data.period).toEqual({ kind: 'month', timezone: 'Asia/Yangon', from: '2026-02-01', to: '2026-02-28', startsAt: '2026-01-31T17:30:00.000Z', endsAt: '2026-02-28T17:30:00.000Z' });
    expect(response.body.data.members).toEqual({ totalRegistered: 10, activeRegistered: 7, inactiveRegistered: 3, newRegistered: 2 });
    expect(response.body.data.attendance).toEqual({ totalRecords: 4, distinctMembers: 3 });
    expect(response.body.data.membershipRequests).toEqual({ currentStatus: { pending: 5, approved: 6, rejected: 1 }, newSubmitted: 2 });
    expect(response.body.data.trends.granularity).toBe('day');
    expect(response.body.data.trends.points).toHaveLength(28);
    expect(response.body.data.trends.points[0]).toEqual({ bucket: '2026-02-01', registrations: 0, attendance: 0, membershipRequests: 0 });
    expect(response.body.data.trends.points[1]).toEqual({ bucket: '2026-02-02', registrations: 2, attendance: 4, membershipRequests: 2 });
    expect(repo.aggregate).toHaveBeenCalledWith({ start: new Date('2026-01-31T17:30:00.000Z'), end: new Date('2026-02-28T17:30:00.000Z'), granularity: 'day' });
  });

  it('handles leap-day custom ranges, monthly trends, and rejects invalid ranges', async () => {
    const custom = await request(app(repository())).get('/api/admin/v1/dashboard/overview?from=2024-02-28&to=2024-03-01').set(auth);
    const monthly = await request(app(repository([{ bucket: '2025-01', registrations: 1, attendance: 2, membershipRequests: 3 }]))).get('/api/admin/v1/dashboard/overview?from=2025-01-01&to=2025-04-30&granularity=month').set(auth);
    const reversed = await request(app()).get('/api/admin/v1/dashboard/overview?from=2026-03-02&to=2026-03-01').set(auth);
    const excessive = await request(app()).get('/api/admin/v1/dashboard/overview?from=2025-01-01&to=2026-01-02').set(auth);
    const conflicting = await request(app()).get('/api/admin/v1/dashboard/overview?month=2026-02&from=2026-02-01&to=2026-02-02').set(auth);

    expect(custom.status).toBe(200);
    expect(custom.body.data.trends.points.map((point: { bucket: string }) => point.bucket)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(monthly.status).toBe(200);
    expect(monthly.body.data.trends).toEqual({ granularity: 'month', points: [
      { bucket: '2025-01', registrations: 1, attendance: 2, membershipRequests: 3 },
      { bucket: '2025-02', registrations: 0, attendance: 0, membershipRequests: 0 },
      { bucket: '2025-03', registrations: 0, attendance: 0, membershipRequests: 0 },
      { bucket: '2025-04', registrations: 0, attendance: 0, membershipRequests: 0 },
    ] });
    expect(reversed.status).toBe(422);
    expect(excessive.status).toBe(422);
    expect(conflicting.status).toBe(422);
  });

  it('returns deterministic zero values and no sensitive records for an authorized no-data period', async () => {
    const empty: DashboardAggregate = {
      totalRegistered: 0, activeRegistered: 0, inactiveRegistered: 0, newRegistered: 0,
      attendanceRecords: 0, distinctAttendanceMembers: 0,
      pendingRequests: 0, approvedRequests: 0, rejectedRequests: 0, newRequests: 0,
    };
    const repo: DashboardRepository = { aggregate: vi.fn(async () => empty), trends: vi.fn(async () => []) };
    const response = await request(app(repo)).get('/api/admin/v1/dashboard/overview?from=2026-01-01&to=2026-01-02').set(auth);
    expect(response.status).toBe(200);
    expect(response.body.data.members).toEqual({ totalRegistered: 0, activeRegistered: 0, inactiveRegistered: 0, newRegistered: 0 });
    expect(response.body.data.attendance).toEqual({ totalRecords: 0, distinctMembers: 0 });
    expect(response.body.data.trends.points).toEqual([
      { bucket: '2026-01-01', registrations: 0, attendance: 0, membershipRequests: 0 },
      { bucket: '2026-01-02', registrations: 0, attendance: 0, membershipRequests: 0 },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('password');
  });
});
