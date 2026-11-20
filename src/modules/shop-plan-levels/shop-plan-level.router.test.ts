import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { ShopPlanLevelRecord, ShopPlanLevelRepository } from './shop-plan-level.repository.js';
import { createShopPlanLevelRouter } from './shop-plan-level.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const allPermissions = ['shop-level:list', 'shop-level:read', 'shop-level:create', 'shop-level:update', 'shop-level:delete'];
const record = (id: number, name: string, status: Status): ShopPlanLevelRecord => ({
  id, name, status, price: 15_000, duration: 3, postLimit: 20,
  planDuration: { id: 3, name: 'Three Months', value: 3 },
  createdAt: new Date(`2026-10-0${id}T00:00:00.000Z`),
});

const identity = (permissionNames: string[], roleNames = ['Synthetic Role']): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Shop Level Admin', roleNames, permissionNames })),
});

const repository = (records: ShopPlanLevelRecord[], references = { shops: 0, shopUpgradeRequests: 0, payments: 0 }): ShopPlanLevelRepository => ({
  findPage: vi.fn(async ({ name, status, durationId, postLimit, limit, offset }) => {
    const matches = records.filter((item) =>
      (!name || item.name.toLowerCase().includes(name.toLowerCase())) &&
      (!status || item.status === status) &&
      (!durationId || item.planDuration?.id === durationId) &&
      (postLimit === undefined || item.postLimit === postLimit));
    return { records: matches.slice(offset, offset + limit), total: matches.length };
  }),
  findById: vi.fn(async (id) => records.find((item) => item.id === id) ?? null),
  findByName: vi.fn(async (name) => records.find((item) => item.name === name) ?? null),
  durationById: vi.fn(async (id) => id === 3 ? { id, value: 3 } : null),
  references: vi.fn(async () => references),
  create: vi.fn(async (input) => ({
    ...record(99, input.name, input.status),
    createdAt: new Date('2026-10-09T00:00:00.000Z'),
    price: input.price,
    duration: input.duration,
    postLimit: input.postLimit,
    planDuration: { id: input.durationId, name: 'Three Months', value: input.duration },
  })),
  update: vi.fn(async (id, input) => {
    const current = records.find((item) => item.id === id)!;
    return {
      ...current,
      ...input,
      ...(input.durationId !== undefined ? { planDuration: { id: input.durationId, name: 'Three Months', value: input.duration! } } : {}),
    };
  }),
  delete: vi.fn(async () => undefined),
});

const app = (repo: ShopPlanLevelRepository, permissions = allPermissions, roleNames = ['Synthetic Role']) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/shop-plan-levels', createShopPlanLevelRouter({ adminIdentityRepository: identity(permissions, roleNames), shopPlanLevelRepository: repo }));
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

  it('requires authentication and create permission while preserving the System Admin bypass', async () => {
    const body = { name: 'Platinum Shop', price: 25_000, durationId: 3, postLimit: 25 };
    const repo = repository([]);
    const unauthenticated = await request(app(repo)).post('/api/admin/v1/shop-plan-levels').send(body);
    const forbidden = await request(app(repo, [])).post('/api/admin/v1/shop-plan-levels').set(auth).send(body);
    const bypass = await request(app(repo, [], ['SuperAdmin'])).post('/api/admin/v1/shop-plan-levels').set(auth).send(body);

    expect([unauthenticated.status, forbidden.status, bypass.status]).toEqual([401, 403, 201]);
    expect(bypass.body.data).toMatchObject({ id: 99, name: 'Platinum Shop', duration: 3, status: 'ACTIVE' });
  });

  it('creates only canonical fields, synchronizes duration months, and records the authenticated actor', async () => {
    const repo = repository([]);
    const response = await request(app(repo)).post('/api/admin/v1/shop-plan-levels').set(auth).send({
      name: '  Gold Shop  ', price: 15_000, durationId: 3, description: '  Gold benefits  ', postLimit: 20, status: 'INACTIVE',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ name: 'Gold Shop', price: 15_000, duration: 3, postLimit: 20, status: 'INACTIVE' });
    expect(repo.create).toHaveBeenCalledWith({ name: 'Gold Shop', price: 15_000, durationId: 3, duration: 3, description: 'Gold benefits', postLimit: 20, status: Status.INACTIVE, actorId: 1 });
    expect(response.body.data).not.toHaveProperty('description');
    expect(response.body.data).not.toHaveProperty('image');
  });

  it('rejects invalid duration, duplicate names, bad numeric values, and unsafe fields', async () => {
    const existing = record(1, 'Gold Shop', Status.ACTIVE);
    const value = app(repository([existing]));
    const invalidDuration = await request(value).post('/api/admin/v1/shop-plan-levels').set(auth).send({ name: 'Silver Shop', price: 1, durationId: 999, postLimit: 1 });
    const duplicate = await request(value).post('/api/admin/v1/shop-plan-levels').set(auth).send({ name: 'Gold Shop', price: 1, durationId: 3, postLimit: 1 });
    const badPrice = await request(value).post('/api/admin/v1/shop-plan-levels').set(auth).send({ name: 'Bad Price', price: -1, durationId: 3, postLimit: 1 });
    const badPostLimit = await request(value).post('/api/admin/v1/shop-plan-levels').set(auth).send({ name: 'Bad Limit', price: 1, durationId: 3, postLimit: 1.5 });
    const unsafe = await request(value).post('/api/admin/v1/shop-plan-levels').set(auth).send({ name: 'Unsafe', price: 1, durationId: 3, postLimit: 1, image: 'hidden.png', createdById: 77, updatedById: 88 });

    expect(invalidDuration.status).toBe(422);
    expect(invalidDuration.body.error).toMatchObject({ code: 'INVALID_REFERENCE', details: { field: 'durationId' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SHOP_LEVEL_NAME_CONFLICT');
    expect([badPrice.status, badPostLimit.status, unsafe.status]).toEqual([422, 422, 422]);
  });

  it('enforces update permission and applies safe partial status and duration updates', async () => {
    const current = record(1, 'Gold Shop', Status.ACTIVE);
    const repo = repository([current]);
    const forbidden = await request(app(repo, ['shop-level:read'])).patch('/api/admin/v1/shop-plan-levels/1').set(auth).send({ status: 'INACTIVE' });
    const updated = await request(app(repo)).patch('/api/admin/v1/shop-plan-levels/1').set(auth).send({ durationId: 3, status: 'INACTIVE' });

    expect(forbidden.status).toBe(403);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ id: 1, duration: 3, status: 'INACTIVE', planDuration: { id: 3, value: 3 } });
    expect(repo.update).toHaveBeenCalledWith(1, { durationId: 3, duration: 3, status: Status.INACTIVE, actorId: 1 });
  });

  it('rejects invalid-duration and duplicate-name updates', async () => {
    const repo = repository([record(1, 'Gold Shop', Status.ACTIVE), record(2, 'Silver Shop', Status.ACTIVE)]);
    const value = app(repo);
    const invalidDuration = await request(value).patch('/api/admin/v1/shop-plan-levels/1').set(auth).send({ durationId: 999 });
    const duplicate = await request(value).patch('/api/admin/v1/shop-plan-levels/1').set(auth).send({ name: 'Silver Shop' });

    expect(invalidDuration.status).toBe(422);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SHOP_LEVEL_NAME_CONFLICT');
  });

  it.each([
    ['Shop', { shops: 1, shopUpgradeRequests: 0, payments: 0 }],
    ['ShopUpgradeRequest', { shops: 0, shopUpgradeRequests: 1, payments: 0 }],
    ['Payment', { shops: 0, shopUpgradeRequests: 0, payments: 1 }],
  ])('blocks deletion referenced by %s without calling delete', async (_relation, references) => {
    const repo = repository([record(1, 'Gold Shop', Status.ACTIVE)], references);
    const response = await request(app(repo)).delete('/api/admin/v1/shop-plan-levels/1').set(auth);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'SHOP_LEVEL_IN_USE', details: references });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('enforces delete permission and deletes an entirely unreferenced level', async () => {
    const repo = repository([record(1, 'Gold Shop', Status.ACTIVE)]);
    const forbidden = await request(app(repo, ['shop-level:read'])).delete('/api/admin/v1/shop-plan-levels/1').set(auth);
    const removed = await request(app(repo)).delete('/api/admin/v1/shop-plan-levels/1').set(auth);

    expect(forbidden.status).toBe(403);
    expect(removed.status).toBe(204);
    expect(repo.delete).toHaveBeenCalledWith(1);
  });
});
