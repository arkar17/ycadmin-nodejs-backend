import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../shared/app-error.js';

const requestIdFor = (request: Parameters<RequestHandler>[0]): string =>
  request.id === undefined ? crypto.randomUUID() : String(request.id);

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.originalUrl} was not found.`,
      requestId: requestIdFor(request),
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ZodError) {
    return response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
        requestId: requestIdFor(request),
      },
    });
  }

  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId: requestIdFor(request),
      },
    });
  }

  request.log?.error({ err: error }, 'Unhandled request error');
  return response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      requestId: requestIdFor(request),
    },
  });
};
