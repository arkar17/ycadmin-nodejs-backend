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
import { PrismaCurrentAdminRepository } from './current-admin.repository.js';
import { createCurrentAdminRouter } from './current-admin.router.js';

const password = 'integration-password';
const browserAuth = { enabled: true, cookieName: 'yc_admin_session', secure: true, sameSite: 'lax' as const, maxAgeSeconds: 28_800, allowedOrigin: 'https://admin.example.test' };
const app = () => { const value = express(); const identity = new PrismaAdminIdentityRepository(); value.use(express.json()); value.use('/api/admin/v1/auth', createAuthRouter({ adminLoginRepository: new PrismaAdminLoginRepository(), browserAuth })); value.use('/api/admin/v1/auth', createCurrentAdminRouter({ adminIdentityRepository: identity, currentAdminRepository: new PrismaCurrentAdminRepository(), browserAuth })); value.use('/api/admin/v1/members', createMemberDirectoryRouter({ adminIdentityRepository: identity, memberDirectoryRepository: new PrismaMemberDirectoryRepository() })); value.use(errorHandler); return value; };
const isolated = () => { const url = new URL(process.env.DATABASE_URL ?? ''); if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.'); };

describe('Admin login isolated PostgreSQL integration', () => {
  beforeEach(async () => {
    isolated();
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE');
    const permission = await prisma.permission.create({ data: { name: 'member:list', description: 'Synthetic test permission' } });
    const role = await prisma.role.create({ data: { name: 'Synthetic login role' } });
    const inactiveRole = await prisma.role.create({ data: { name: 'Inactive login role', status: Status.INACTIVE } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    const hash = await bcrypt.hash(password, 10);
    const active = await prisma.user.create({ data: { name: 'Integration Admin', email: 'login.admin@example.test', username: 'login-admin', password: hash } });
    await prisma.userRole.create({ data: { userId: active.id, roleId: role.id } });
    await prisma.user.create({ data: { name: 'Inactive Admin', email: 'inactive.login@example.test', username: 'inactive-login', password: hash, status: Status.INACTIVE } });
    await prisma.user.create({ data: { name: 'No Role Admin', email: 'no.role@example.test', username: 'no-role-login', password: hash } });
    const inactiveRoleUser = await prisma.user.create({ data: { name: 'Inactive Role Admin', email: 'inactive.role@example.test', username: 'inactive-role-login', password: hash } });
    await prisma.userRole.create({ data: { userId: inactiveRoleUser.id, roleId: inactiveRole.id } });
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

    await getPrismaClient().rolePermission.create({ data: { roleId: rolePermission.roleId, permissionId: rolePermission.permissionId } });
    await getPrismaClient().permission.update({ where: { id: rolePermission.permissionId }, data: { status: Status.INACTIVE } });
    const inactivePermission = await request(value).get('/api/admin/v1/members').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(inactivePermission.status).toBe(403);
  });

  it('sets a browser cookie and preserves immediate database-backed permission changes', async () => {
    const value = app();
    const login = await request(value)
      .post('/api/admin/v1/auth/login')
      .set('Origin', browserAuth.allowedOrigin)
      .send({ emailOrUsername: 'login-admin', password });
    const setCookie = login.headers['set-cookie'];
    const cookieHeader = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';', 1)[0];

    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeUndefined();
    expect(cookieHeader).toEqual(expect.stringContaining(`${browserAuth.cookieName}=`));
    const before = await request(value).get('/api/admin/v1/auth/me').set('Cookie', cookieHeader!);
    expect(before.status).toBe(200);
    expect(before.body.data.permissions).toEqual([expect.objectContaining({ name: 'member:list' })]);

    const rolePermission = await getPrismaClient().rolePermission.findFirstOrThrow();
    await getPrismaClient().rolePermission.delete({ where: { id: rolePermission.id } });
    const after = await request(value).get('/api/admin/v1/auth/me').set('Cookie', cookieHeader!);
    expect(after.status).toBe(200);
    expect(after.body.data.permissions).toEqual([]);
  });

  it('revokes authentication on the next request when the User, Role, or assignment is deactivated or removed', async () => {
    const value = app();
    const prisma = getPrismaClient();
    const login = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password });
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'login-admin' } });
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId: user.id } });

    await prisma.user.update({ where: { id: user.id }, data: { status: Status.INACTIVE } });
    expect((await request(value).get('/api/admin/v1/members').set('Authorization', authorization)).status).toBe(401);

    await prisma.user.update({ where: { id: user.id }, data: { status: Status.ACTIVE } });
    await prisma.role.update({ where: { id: assignment.roleId }, data: { status: Status.INACTIVE } });
    expect((await request(value).get('/api/admin/v1/members').set('Authorization', authorization)).status).toBe(401);

    await prisma.role.update({ where: { id: assignment.roleId }, data: { status: Status.ACTIVE } });
    await prisma.userRole.delete({ where: { id: assignment.id } });
    expect((await request(value).get('/api/admin/v1/members').set('Authorization', authorization)).status).toBe(401);
  });

  it('removes the SuperAdmin bypass on the next request while preserving normal-role authentication', async () => {
    const value = app();
    const prisma = getPrismaClient();
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'login-admin' } });
    const ordinaryAssignment = await prisma.userRole.findFirstOrThrow({ where: { userId: user.id } });
    const superAdminRole = await prisma.role.create({ data: { name: 'SuperAdmin' } });
    const superAdminAssignment = await prisma.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ordinaryAssignment.roleId } });

    const login = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password });
    const authorization = `Bearer ${login.body.data.accessToken}`;
    expect((await request(value).get('/api/admin/v1/members').set('Authorization', authorization)).status).toBe(200);

    await prisma.userRole.delete({ where: { id: superAdminAssignment.id } });
    expect((await request(value).get('/api/admin/v1/members').set('Authorization', authorization)).status).toBe(403);
  });

  it('rejects incorrect, inactive-account, no-role, and inactive-role credentials without exposing hashes', async () => {
    const value = app();
    const wrong = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password: 'wrong' });
    const inactive = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'inactive-login', password });
    const noRole = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'no-role-login', password });
    const inactiveRole = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'inactive-role-login', password });
    expect([wrong.status, inactive.status, noRole.status, inactiveRole.status]).toEqual([401, 401, 401, 401]);
    expect(JSON.stringify(wrong.body)).not.toMatch(/\$2[aby]\$/);
    expect(wrong.body.error.code).toBe(inactive.body.error.code);
    expect(noRole.body.error.code).toBe(inactive.body.error.code);
    expect(inactiveRole.body.error.code).toBe(inactive.body.error.code);
  });
});
