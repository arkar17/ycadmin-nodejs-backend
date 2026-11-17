import request from 'supertest';

import { createApp } from './app.js';

describe('application infrastructure', () => {
  it('serves a database-independent health check', async () => {
    const response = await request(createApp()).get('/api/admin/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: 'ok' } });
  });

  it('uses the standardized not-found error envelope', async () => {
    const response = await request(createApp()).get('/api/admin/v1/not-a-route');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
