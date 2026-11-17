import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { FeedbackPage, FeedbackRepository } from './feedback.repository.js';
import { createFeedbackRouter } from './feedback.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const identityRepository = (permissions: string[]): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({
    id: 1,
    displayName: 'Feedback Admin',
    roleNames: ['Synthetic Role'],
    permissionNames: permissions,
  })),
});

const repositoryFor = (page: FeedbackPage, detail = page.records[0] ?? null): FeedbackRepository => ({
  findPage: vi.fn(async () => page),
  findById: vi.fn(async () => detail),
});

const createApp = (repository: FeedbackRepository, permissions = ['feedback:list', 'feedback:read']) => {
  const app = express();
  app.use('/api/admin/v1/feedback', createFeedbackRouter({ adminIdentityRepository: identityRepository(permissions), feedbackRepository: repository }));
  app.use(errorHandler);
  return app;
};

const token = () => jwt.sign({ id: 1, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

const feedback = {
  id: 7,
  name: 'Synthetic feedback message',
  createdAt: new Date('2026-10-10T10:00:00.000Z'),
  member: { id: 9, name: 'Ada Feedback', code: 'FB-009' },
};

describe('Feedback router', () => {
  it('requires the distinct list and detail permissions', async () => {
    const repository = repositoryFor({ records: [feedback], total: 1 });
    const missingToken = await request(createApp(repository)).get('/api/admin/v1/feedback');
    const missingList = await request(createApp(repository, ['feedback:read']))
      .get('/api/admin/v1/feedback')
      .set('Authorization', `Bearer ${token()}`);
    const missingRead = await request(createApp(repository, ['feedback:list']))
      .get('/api/admin/v1/feedback/7')
      .set('Authorization', `Bearer ${token()}`);

    expect(missingToken.status).toBe(401);
    expect(missingList.status).toBe(403);
    expect(missingRead.status).toBe(403);
  });

  it('returns a safe paginated REST DTO and converts a Yangon date to UTC instants', async () => {
    const repository = repositoryFor({ records: [feedback], total: 3 });
    const response = await request(createApp(repository))
      .get('/api/admin/v1/feedback?name=Ada&clientCode=FB&date=2026-10-10&limit=1&offset=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        {
          id: 7,
          feedbackMessage: 'Synthetic feedback message',
          member: { id: 9, name: 'Ada Feedback', clientCode: 'FB-009' },
          createdAt: '2026-10-10T10:00:00.000Z',
        },
      ],
      pagination: { total: 3, limit: 1, offset: 1, currentPage: 2, totalPages: 3 },
    });
    expect(repository.findPage).toHaveBeenCalledWith({
      memberName: 'Ada',
      clientCode: 'FB',
      createdAt: {
        start: new Date('2026-10-09T17:30:00.000Z'),
        end: new Date('2026-10-10T17:30:00.000Z'),
      },
      limit: 1,
      offset: 1,
    });
  });

  it('supports the existing frontend client_code filter alias', async () => {
    const repository = repositoryFor({ records: [], total: 0 });
    const response = await request(createApp(repository))
      .get('/api/admin/v1/feedback?client_code=FB-009')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(repository.findPage).toHaveBeenCalledWith({ clientCode: 'FB-009', limit: 20, offset: 0 });
  });

  it('rejects malformed input and returns 404 for absent feedback', async () => {
    const repository = repositoryFor({ records: [], total: 0 }, null);
    const app = createApp(repository);
    const malformedDate = await request(app)
      .get('/api/admin/v1/feedback?date=2026-02-30')
      .set('Authorization', `Bearer ${token()}`);
    const malformedId = await request(app)
      .get('/api/admin/v1/feedback/not-a-number')
      .set('Authorization', `Bearer ${token()}`);
    const missing = await request(app)
      .get('/api/admin/v1/feedback/999')
      .set('Authorization', `Bearer ${token()}`);

    expect(malformedDate.status).toBe(422);
    expect(malformedId.status).toBe(422);
    expect(missing.status).toBe(404);
  });

  it('does not expose extra Member or feedback fields supplied by a repository', async () => {
    const unsafe = {
      ...feedback,
      member: { ...feedback.member, email: 'private@example.test', phone: '+959000000' },
      updatedAt: new Date(),
    } as unknown as FeedbackPage['records'][number];
    const response = await request(createApp(repositoryFor({ records: [unsafe], total: 1 })))
      .get('/api/admin/v1/feedback')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.body.data[0]).not.toHaveProperty('updatedAt');
    expect(response.body.data[0].member).not.toHaveProperty('email');
    expect(response.body.data[0].member).not.toHaveProperty('phone');
  });
});
