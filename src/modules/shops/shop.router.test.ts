import { MemberRequestStatus, Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createShopRouter } from './shop.router.js';
import type { ShopRecord, ShopRepository } from './shop.repository.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const headers = { Authorization: `Bearer ${jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256' })}` };
const identity = (permissionNames: string[]): AdminIdentityRepository => ({ findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Admin', roleNames: [], permissionNames })) });
const record: ShopRecord = {
  id: 7, name: 'Safe Shop', logo: 'secret-storage-key.png', status: Status.ACTIVE, memberId: 4, createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-02T00:00:00Z'),
  member: { id: 4, name: 'Owner', code: 'YC0004', email: 'owner@example.com', phone: '+959000000' },
  shopLevel: { id: 2, name: 'Gold', status: Status.ACTIVE, postLimit: 12, price: 5000, duration: 3, planDuration: { id: 1, name: 'Months', value: 3 } },
  createdBy: { id: 1, name: 'Creator' }, updatedBy: { id: 2, name: 'Updater' }, _count: { posts: 5, shopRatings: 2 }, shopRatings: [{ rate: 3 }, { rate: 5 }],
  latestUpgradeRequest: { id: 10, status: MemberRequestStatus.PENDING, postCount: 0, createdAt: new Date('2026-11-03T00:00:00Z') },
  latestApprovedUpgradeRequest: { id: 9, status: MemberRequestStatus.APPROVED, postCount: 8, createdAt: new Date('2026-10-03T00:00:00Z') },
};
const repository = (): ShopRepository => ({ findPage: vi.fn(async () => ({ records: [record], total: 21 })), findById: vi.fn(async (id) => id === 7 ? record : null) });
const app = (repo: ShopRepository, permissions = ['shop:list', 'shop:read']) => { const value = express(); value.use('/api/admin/v1/shops', createShopRouter({ adminIdentityRepository: identity(permissions), shopRepository: repo })); value.use(errorHandler); return value; };

describe('Shop router', () => {
  it('enforces permissions and returns paginated, redacted summaries', async () => {
    const repo = repository();
    const response = await request(app(repo)).get('/api/admin/v1/shops?name=Safe&memberId=4&memberName=Owner&memberCode=YC&shopLevelId=2&status=ACTIVE&limit=10&offset=10').set(headers);
    const denied = await request(app(repo, ['shop:read'])).get('/api/admin/v1/shops').set(headers);
    expect(response.status).toBe(200); expect(denied.status).toBe(403);
    expect(response.body.pagination).toEqual({ total: 21, limit: 10, offset: 10, currentPage: 2, totalPages: 3 });
    expect(response.body.data[0]).toMatchObject({ hasLogo: true, owner: { clientCode: 'YC0004' }, currentLevel: { postLimit: 12 }, posts: { total: 5, remaining: 8, quotaRequestId: 9 }, ratings: { count: 2, average: 4 }, latestUpgradeRequest: { id: 10, status: 'PENDING' } });
    expect(JSON.stringify(response.body)).not.toContain('secret-storage-key');
    expect(repo.findPage).toHaveBeenCalledWith(expect.objectContaining({ memberId: 4, shopLevelId: 2, status: 'ACTIVE' }));
  });
  it('returns safe detail, enforces read permission, and handles missing shops', async () => {
    const repo = repository(); const detail = await request(app(repo)).get('/api/admin/v1/shops/7').set(headers); const denied = await request(app(repo, ['shop:list'])).get('/api/admin/v1/shops/7').set(headers); const missing = await request(app(repo)).get('/api/admin/v1/shops/99').set(headers);
    expect(detail.status).toBe(200); expect(denied.status).toBe(403); expect(missing.status).toBe(404);
    expect(detail.body.data).toMatchObject({ owner: { email: 'owner@example.com', phone: '+959000000' }, currentLevel: { currentPrice: 5000, duration: 3 }, createdBy: { name: 'Creator' } });
    expect(JSON.stringify(detail.body)).not.toContain('secret-storage-key');
  });
  it('rejects unknown and malformed query values', async () => { const value = app(repository()); const responses = await Promise.all([request(value).get('/api/admin/v1/shops?unknown=x').set(headers), request(value).get('/api/admin/v1/shops?limit=101').set(headers), request(value).get('/api/admin/v1/shops?status=active').set(headers)]); expect(responses.map((entry) => entry.status)).toEqual([422, 422, 422]); });
});
