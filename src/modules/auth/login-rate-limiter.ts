import type { RequestHandler } from 'express';

import { AppError } from '../../shared/app-error.js';

type Entry = { attempts: number; resetAt: number };

/**
 * Local safety guard for development/single-process deployments. Production
 * must move this to the ingress layer or a shared store before scaling.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  public constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  public consume(key: string): boolean {
    const current = this.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= current) {
      this.entries.set(key, { attempts: 1, resetAt: current + this.windowMs });
      return true;
    }
    if (existing.attempts >= this.maxAttempts) return false;
    existing.attempts += 1;
    return true;
  }
}

export const createLoginRateLimit = (limiter: LoginRateLimiter): RequestHandler => (request, _response, next) => {
  // Express derives req.ip from the peer unless an explicitly trusted proxy is configured.
  if (!limiter.consume(request.ip ?? 'unknown')) {
    return next(new AppError({ statusCode: 429, code: 'LOGIN_THROTTLED', message: 'Too many sign-in attempts. Please try again later.' }));
  }
  return next();
};
