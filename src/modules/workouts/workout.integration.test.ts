import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PrismaWorkoutRepository } from './workout.repository.js';
import { createWorkoutRouter } from './workout.router.js';

const prefix = `Stage3J Workout ${process.pid}`;
const isolated = () => { const url = new URL(process.env.DATABASE_URL ?? ''); if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.'); };
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });
const app = () => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/workout-videos', createWorkoutRouter({ adminIdentityRepository: new PrismaAdminIdentityRepository(), workoutRepository: new PrismaWorkoutRepository() })); value.use(errorHandler); return value; };
let ids: Record<string, number | boolean> = {};

beforeAll(async () => {
  isolated(); const p = getPrismaClient();
  const existingList = await p.permission.findUnique({ where: { name: 'workout:list' } }); const existingRead = await p.permission.findUnique({ where: { name: 'workout:read' } }); const existingUpdate = await p.permission.findUnique({ where: { name: 'workout:update' } });
  const list = existingList ?? await p.permission.create({ data: { name: 'workout:list', description: prefix } }); const read = existingRead ?? await p.permission.create({ data: { name: 'workout:read', description: prefix } }); const update = existingUpdate ?? await p.permission.create({ data: { name: 'workout:update', description: prefix } });
  const role = await p.role.create({ data: { name: `${prefix} Role`, description: prefix } });
  const admin = await p.user.create({ data: { name: prefix, username: `${prefix.replaceAll(' ', '-').toLowerCase()}-admin`, email: `${process.pid}.stage3j@example.test`, password: 'test-hash' } });
  await p.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: list.id }, { roleId: role.id, permissionId: read.id }, { roleId: role.id, permissionId: update.id }] }); await p.userRole.create({ data: { roleId: role.id, userId: admin.id } });
  const [type, duration, category, goal, level, place] = await Promise.all([p.memberType.create({ data: { name: `${prefix} Type` } }), p.planDuration.create({ data: { name: `${prefix} Duration`, value: 1 } }), p.category.create({ data: { name: `${prefix} Category` } }), p.bodyGoal.create({ data: { name: `${prefix} Goal` } }), p.proficientLevel.create({ data: { name: `${prefix} Level` } }), p.place.create({ data: { name: `${prefix} Place` } })]);
  const plan = await p.memberPlan.create({ data: { name: `${prefix} Plan`, memberTypeId: type.id, durationId: duration.id, duration: 1, price: 0 } });
  const [older, newer] = await Promise.all([p.workout.create({ data: { name: `${prefix} Older`, video: 'test://video/older', gender: 'BOTH', categoryId: category.id, bodyGoalId: goal.id, proficientLevelId: level.id, placeId: place.id, memberPlanId: plan.id, videoDuration: 30, createdAt: new Date('2026-01-01T00:00:00.000Z') } }), p.workout.create({ data: { name: `${prefix} Newer`, video: 'test://video/newer', gender: 'FEMALE', categoryId: category.id, bodyGoalId: goal.id, proficientLevelId: level.id, placeId: place.id, memberPlanId: plan.id, videoDuration: 60, createdAt: new Date('2026-01-02T00:00:00.000Z') } })]);
  const member = await p.member.create({ data: { name: `${prefix} Member`, code: `S3J-${process.pid}`, password: 'test-hash' } }); const history = await p.personalWorkoutHistory.create({ data: { memberId: member.id, workoutId: older.id, calory: 1, totalTime: 1 } });
  ids = { list: list.id, read: read.id, update: update.id, ownsList: !existingList, ownsRead: !existingRead, ownsUpdate: !existingUpdate, role: role.id, admin: admin.id, type: type.id, duration: duration.id, category: category.id, goal: goal.id, level: level.id, place: place.id, plan: plan.id, older: older.id, newer: newer.id, member: member.id, history: history.id };
});
afterAll(async () => { const p = getPrismaClient(); if (Object.keys(ids).length) { await p.personalWorkoutHistory.deleteMany({ where: { id: ids.history as number } }); await p.workout.deleteMany({ where: { id: { in: [ids.older as number, ids.newer as number] } } }); await p.member.deleteMany({ where: { id: ids.member as number } }); await p.userRole.deleteMany({ where: { userId: ids.admin as number } }); await p.rolePermission.deleteMany({ where: { roleId: ids.role as number } }); await p.user.deleteMany({ where: { id: ids.admin as number } }); await p.role.deleteMany({ where: { id: ids.role as number } }); if (ids.ownsList) await p.permission.deleteMany({ where: { id: ids.list as number, description: prefix } }); if (ids.ownsRead) await p.permission.deleteMany({ where: { id: ids.read as number, description: prefix } }); if (ids.ownsUpdate) await p.permission.deleteMany({ where: { id: ids.update as number, description: prefix } }); await p.memberPlan.deleteMany({ where: { id: ids.plan as number } }); await p.memberType.deleteMany({ where: { id: ids.type as number } }); await p.planDuration.deleteMany({ where: { id: ids.duration as number } }); await p.category.deleteMany({ where: { id: ids.category as number } }); await p.bodyGoal.deleteMany({ where: { id: ids.goal as number } }); await p.proficientLevel.deleteMany({ where: { id: ids.level as number } }); await p.place.deleteMany({ where: { id: ids.place as number } }); } await disconnectDatabase(); });

describe('Workout isolated PostgreSQL integration', () => {
  it('filters, orders, paginates, returns detail, and enforces separately provisioned permissions', async () => {
    const id = (key: string) => ids[key] as number;
    const list = await request(app()).get(`/api/admin/v1/workout-videos?name=${encodeURIComponent(prefix)}&categoryId=${id('category')}&memberPlanId=${id('plan')}&limit=1&offset=0`).set('Authorization', `Bearer ${token(id('admin'))}`);
    const detail = await request(app()).get(`/api/admin/v1/workout-videos/${id('older')}`).set('Authorization', `Bearer ${token(id('admin'))}`);
    const updated = await request(app()).patch(`/api/admin/v1/workout-videos/${id('older')}`).set('Authorization', `Bearer ${token(id('admin'))}`).send({ status: 'INACTIVE', name: `${prefix} Disabled` });
    const historyCount = await getPrismaClient().personalWorkoutHistory.count({ where: { id: id('history'), workoutId: id('older') } });
    await getPrismaClient().rolePermission.delete({ where: { roleId_permissionId: { roleId: id('role'), permissionId: id('read') } } });
    const denied = await request(app()).get(`/api/admin/v1/workout-videos/${id('older')}`).set('Authorization', `Bearer ${token(id('admin'))}`);
    expect(list.status).toBe(200); expect(list.body.pagination).toEqual({ total: 2, limit: 1, offset: 0, currentPage: 1, totalPages: 2 }); expect(list.body.data[0].id).toBe(id('newer')); expect(detail.status).toBe(200); expect(detail.body.data.video).toBe('test://video/older'); expect(detail.body.data).not.toHaveProperty('personalWorkoutHistories'); expect(updated.status).toBe(200); expect(updated.body.data).toMatchObject({ status: 'INACTIVE', name: `${prefix} Disabled`, video: 'test://video/older' }); expect(historyCount).toBe(1); expect(denied.status).toBe(403);
  });
});
