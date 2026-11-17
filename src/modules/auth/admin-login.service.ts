import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/app-error.js';
import type { AdminLoginInput } from './admin-login.schema.js';
import type { AdminLoginRepository } from './admin-login.repository.js';

export type AdminLoginResult = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: { id: number; name: string; username: string };
};

const invalidCredentials = () => new AppError({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' });

export class AdminLoginService {
  public constructor(private readonly repository: AdminLoginRepository) {}

  public async login(input: AdminLoginInput): Promise<AdminLoginResult> {
    const account = await this.repository.findActiveByEmailOrUsername(input.emailOrUsername);
    // bcrypt's compare is deliberately still performed for an unknown/inactive
    // account to reduce account-existence timing differences.
    const passwordHash = account?.passwordHash ?? '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const passwordMatches = await bcrypt.compare(input.password, passwordHash);
    if (!account || !passwordMatches) throw invalidCredentials();

    const accessToken = jwt.sign(
      { id: account.id, loginType: 'admin' },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );
    const decoded = jwt.decode(accessToken);
    if (typeof decoded === 'string' || !decoded?.exp) throw new Error('JWT signing did not produce an expiration claim.');

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      user: { id: account.id, name: account.name, username: account.username },
    };
  }
}
