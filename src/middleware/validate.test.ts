import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { errorHandler } from './error-handler.js';
import { validate } from './validate.js';

describe('validation middleware', () => {
  it('returns the standardized validation envelope', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/example',
      validate(z.object({ body: z.object({ name: z.string().min(1) }), params: z.object({}), query: z.object({}) })),
      (_request, response) => response.sendStatus(204),
    );
    app.use(errorHandler);

    const response = await request(app).post('/example').send({ name: '' });

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Request validation failed.' });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
