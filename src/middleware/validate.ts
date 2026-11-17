import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

export const validate = (schema: ZodTypeAny): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse({
    body: request.body,
    params: request.params,
    query: request.query,
  });

  if (!result.success) {
    return next(result.error);
  }

  request.body = result.data.body;
  request.params = result.data.params;
  // Express 5 exposes `request.query` through a getter. Keep parsed query data
  // on the request rather than assigning to that getter.
  request.validated = result.data;
  return next();
};
