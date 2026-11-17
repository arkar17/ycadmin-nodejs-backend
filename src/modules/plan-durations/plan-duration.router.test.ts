import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { PlanDurationRecord, PlanDurationRepository } from './plan-duration.repository.js';
import { createPlanDurationRouter } from './plan-duration.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const allPermissions = ['plan-duration:list', 'plan-duration:create', 'plan-duration:update', 'plan-duration:delete'];
const record = (id: number, name: string, value: number): PlanDurationRecord => ({ id, name, value, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z') });

const identityRepository = (permissions: string[]): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Duration Admin', roleNames: ['Synthetic Role'], permissionNames: permissions })),
});

const repositoryFor = (records: PlanDurationRecord[], references = { memberPlans: 0, shopLevels: 0 }): PlanDurationRepository => ({
  findPage: vi.fn(async ({ name, limit, offset }) => {
    const matches = name ? records.filter((item) => item.name.toLowerCase().includes(name.toLowerCase())) : records;
    return { records: matches.slice(offset, offset + limit), total: matches.length };
  }),
  findById: vi.fn(async (id) => records.find((item) => item.id === id) ?? null),
  findByValue: vi.fn(async (value) => records.find((item) => item.value === value) ?? null),
  create: vi.fn(async (input) => record(99, input.name, input.value)),
  update: vi.fn(async (id, input) => ({ ...records.find((item) => item.id === id)!, ...input })),
  referenceCount: vi.fn(async () => references),
  delete: vi.fn(async () => undefined),
});

const createApp = (repository: PlanDurationRepository, permissions = allPermissions) => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/v1/plan-durations', createPlanDurationRouter({ adminIdentityRepository: identityRepository(permissions), planDurationRepository: repository }));
  app.use(errorHandler);
  return app;
};

const token = () => jwt.sign({ id: 1, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

describe('Plan Duration router', () => {
  it('enforces a distinct permission for every action', async () => {
    const repository = repositoryFor([record(1, 'One Month', 1)]);
    const list = await request(createApp(repository, [])).get('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token()}`);
    const create = await request(createApp(repository, ['plan-duration:list'])).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token()}`).send({ name: 'Two Months', value: 2 });
    const update = await request(createApp(repository, ['plan-duration:update'])).patch('/api/admin/v1/plan-durations/1').set('Authorization', `Bearer ${token()}`).send({ name: 'One calendar month' });
    const remove = await request(createApp(repository, ['plan-duration:delete'])).delete('/api/admin/v1/plan-durations/1').set('Authorization', `Bearer ${token()}`);

    expect(list.status).toBe(403);
    expect(create.status).toBe(403);
    expect(update.status).toBe(200);
    expect(remove.status).toBe(204);
  });

  it('lists safe paginated duration DTOs using bounded validated input', async () => {
    const response = await request(createApp(repositoryFor([record(2, 'Three Months', 3), record(1, 'One Month', 1)])))
      .get('/api/admin/v1/plan-durations?name=Month&limit=1&offset=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [{ id: 1, name: 'One Month', value: 1 }], pagination: { total: 2, limit: 1, offset: 1, currentPage: 2, totalPages: 2 } });
  });

  it('creates values, rejects duplicates, and validates bodies', async () => {
    const repository = repositoryFor([record(1, 'One Month', 1)]);
    const app = createApp(repository);
    const created = await request(app).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token()}`).send({ name: 'Two Months', value: 2 });
    const duplicate = await request(app).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token()}`).send({ name: 'Duplicate', value: 1 });
    const malformed = await request(app).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token()}`).send({ name: '', value: 0 });

    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({ id: 99, name: 'Two Months', value: 2 });
    expect(duplicate.status).toBe(409);
    expect(malformed.status).toBe(422);
  });

  it('rejects updates and deletion when a duration is referenced', async () => {
    const app = createApp(repositoryFor([record(1, 'One Month', 1)], { memberPlans: 1, shopLevels: 1 }));
    const updated = await request(app).patch('/api/admin/v1/plan-durations/1').set('Authorization', `Bearer ${token()}`).send({ name: 'One calendar month' });
    const deleted = await request(app).delete('/api/admin/v1/plan-durations/1').set('Authorization', `Bearer ${token()}`);

    expect(updated.status).toBe(409);
    expect(deleted.status).toBe(409);
    expect(deleted.body.error.code).toBe('DURATION_IN_USE');
  });

  it('returns 404 for missing records and 422 for malformed identifiers', async () => {
    const app = createApp(repositoryFor([]));
    const missing = await request(app).patch('/api/admin/v1/plan-durations/9').set('Authorization', `Bearer ${token()}`).send({ name: 'Missing' });
    const malformed = await request(app).delete('/api/admin/v1/plan-durations/nope').set('Authorization', `Bearer ${token()}`);

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(422);
  });
});
