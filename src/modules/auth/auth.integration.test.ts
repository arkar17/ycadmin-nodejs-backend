import bcrypt from 'bcrypt';
import express from 'express';
import request from 'supertest';
import { Status } from '@prisma/client';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createMemberDirectoryRouter } from '../members/member-directory.router.js';
import { PrismaMemberDirectoryRepository } from '../members/member-directory.repository.js';
import { PrismaAdminIdentityRepository } from './admin-identity.repository.js';
import { PrismaAdminLoginRepository } from './admin-login.repository.js';
import { createAuthRouter } from './auth.router.js';

const password = 'integration-password';
const app = () => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/auth', createAuthRouter({ adminLoginRepository: new PrismaAdminLoginRepository() })); value.use('/api/admin/v1/members', createMemberDirectoryRouter({ adminIdentityRepository: new PrismaAdminIdentityRepository(), memberDirectoryRepository: new PrismaMemberDirectoryRepository() })); value.use(errorHandler); return value; };
const isolated = () => { const url = new URL(process.env.DATABASE_URL ?? ''); if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.'); };

describe('Admin login isolated PostgreSQL integration', () => {
  beforeEach(async () => {
    isolated();
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE');
    const permission = await prisma.permission.create({ data: { name: 'member:list', description: 'Synthetic test permission' } });
    const role = await prisma.role.create({ data: { name: 'Synthetic login role' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    const hash = await bcrypt.hash(password, 10);
    const active = await prisma.user.create({ data: { name: 'Integration Admin', email: 'login.admin@example.test', username: 'login-admin', password: hash } });
    await prisma.userRole.create({ data: { userId: active.id, roleId: role.id } });
    await prisma.user.create({ data: { name: 'Inactive Admin', email: 'inactive.login@example.test', username: 'inactive-login', password: hash, status: Status.INACTIVE } });
  });

  afterAll(async () => { await disconnectDatabase(); });

  it('logs in an active User, then enforces database permission removal on the issued token', async () => {
    const value = app();
    const login = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password });
    expect(login.status).toBe(200);
    const authorized = await request(value).get('/api/admin/v1/members').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(authorized.status).toBe(200);
    const rolePermission = await getPrismaClient().rolePermission.findFirstOrThrow();
    await getPrismaClient().rolePermission.delete({ where: { id: rolePermission.id } });
    const revoked = await request(value).get('/api/admin/v1/members').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(revoked.status).toBe(403);
  });

  it('rejects incorrect and inactive-account credentials without exposing hashes', async () => {
    const value = app();
    const wrong = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password: 'wrong' });
    const inactive = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'inactive-login', password });
    expect([wrong.status, inactive.status]).toEqual([401, 401]);
    expect(JSON.stringify(wrong.body)).not.toMatch(/\$2[aby]\$/);
    expect(wrong.body.error.code).toBe(inactive.body.error.code);
  });
});
