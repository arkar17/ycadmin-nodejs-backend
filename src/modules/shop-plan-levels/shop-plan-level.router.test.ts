import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { ShopPlanLevelRecord, ShopPlanLevelRepository } from './shop-plan-level.repository.js';
import { createShopPlanLevelRouter } from './shop-plan-level.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const record = (id: number, name: string, status: Status): ShopPlanLevelRecord => ({
  id, name, status, price: 15_000, duration: 3, postLimit: 20,
  planDuration: { id: 3, name: 'Three Months', value: 3 },
  createdAt: new Date(`2026-10-0${id}T00:00:00.000Z`),
});

const identity = (permissionNames: string[]): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Shop Level Admin', roleNames: ['Synthetic Role'], permissionNames })),
});

const repository = (records: ShopPlanLevelRecord[]): ShopPlanLevelRepository => ({
  findPage: vi.fn(async ({ name, status, durationId, postLimit, limit, offset }) => {
    const matches = records.filter((item) =>
      (!name || item.name.toLowerCase().includes(name.toLowerCase())) &&
      (!status || item.status === status) &&
      (!durationId || item.planDuration?.id === durationId) &&
      (postLimit === undefined || item.postLimit === postLimit));
    return { records: matches.slice(offset, offset + limit), total: matches.length };
  }),
  findById: vi.fn(async (id) => records.find((item) => item.id === id) ?? null),
});

const app = (repo: ShopPlanLevelRepository, permissions = ['shop-level:list', 'shop-level:read']) => {
  const value = express();
  value.use('/api/admin/v1/shop-plan-levels', createShopPlanLevelRouter({ adminIdentityRepository: identity(permissions), shopPlanLevelRepository: repo }));
  value.use(errorHandler);
  return value;
};

const auth = { Authorization: `Bearer ${jwt.sign({ id: 1, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' })}` };

describe('Shop plan level router', () => {
  it('requires a current Admin and distinct list/read permissions', async () => {
    expect((await request(app(repository([]))).get('/api/admin/v1/shop-plan-levels')).status).toBe(401);
    expect((await request(app(repository([]), ['shop-level:read'])).get('/api/admin/v1/shop-plan-levels').set(auth)).status).toBe(403);
    expect((await request(app(repository([]), ['shop-level:list'])).get('/api/admin/v1/shop-plan-levels/1').set(auth)).status).toBe(403);
  });

  it('filters and paginates deterministic safe ShopLevel DTOs', async () => {
    const repo = repository([record(3, 'Gold Shop', Status.ACTIVE), record(2, 'Silver Shop', Status.ACTIVE), record(1, 'Legacy Shop', Status.INACTIVE)]);
    const response = await request(app(repo)).get('/api/admin/v1/shop-plan-levels?name=Shop&status=ACTIVE&durationId=3&postLimit=20&limit=1&offset=1').set(auth);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [{ id: 2, name: 'Silver Shop', price: 15000, duration: 3, postLimit: 20, status: 'ACTIVE', planDuration: { id: 3, name: 'Three Months', value: 3 }, createdAt: '2026-10-02T00:00:00.000Z' }], pagination: { total: 2, limit: 1, offset: 1, currentPage: 2, totalPages: 2 } });
    expect(repo.findPage).toHaveBeenCalledWith({ name: 'Shop', status: Status.ACTIVE, durationId: 3, postLimit: 20, limit: 1, offset: 1 });
  });

  it('returns 404 for an absent level and rejects malformed or unsupported query fields', async () => {
    const repo = repository([record(1, 'Shop', Status.ACTIVE)]);
    expect((await request(app(repo)).get('/api/admin/v1/shop-plan-levels/99').set(auth)).status).toBe(404);
    expect((await request(app(repo)).get('/api/admin/v1/shop-plan-levels?limit=101').set(auth)).status).toBe(422);
    expect((await request(app(repo)).get('/api/admin/v1/shop-plan-levels?levelCount=1').set(auth)).status).toBe(422);
  });
});
