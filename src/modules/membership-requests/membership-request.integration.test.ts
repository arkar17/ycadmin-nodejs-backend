import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MemberRequestStatus, PaymentRequestType, PaymentStatus, Status } from '@prisma/client';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PrismaPaymentRepository } from '../payments/payment.repository.js';
import { PrismaMembershipRequestRepository } from './membership-request.repository.js';
import { createMembershipRequestRouter } from './membership-request.router.js';
import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { MembershipPaymentProofService } from './payment-proof.service.js';
import type { PaymentProofFetcher } from './payment-proof.fetcher.js';
import { PaymentProofFetchFailure } from './payment-proof.fetcher.js';
import type { PaymentProofImageNormalizer } from './payment-proof.image.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const permissions = ['member-request:list', 'member-request:read', 'member-request:update'];
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const proofConfig: PaymentProofConfig = { enabled: true, allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com', bucket: 'yc-fitness-uat', keyPrefix: 'payment-attachments/', maxBytes: 5_242_880, maxPixels: 40_000_000, timeoutMs: 5_000 };
const testProofService = (repository: PrismaMembershipRequestRepository, fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) }, normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => Buffer.from('normalized-test-webp')) }) => new MembershipPaymentProofService(repository, proofConfig, fetcher, normalizer);
const app = (paymentProofService?: MembershipPaymentProofService) => {
  const value = express();
  value.use(express.json());
  const repository = new PrismaMembershipRequestRepository();
  value.use('/api/admin/v1/membership-requests', createMembershipRequestRouter({ adminIdentityRepository: new PrismaAdminIdentityRepository(), membershipRequestRepository: repository, paymentProofService: paymentProofService ?? testProofService(repository) }));
  value.use(errorHandler);
  return value;
};
const authorize = (adminId: number) => ({ Authorization: `Bearer ${token(adminId)}` });
const assertIsolated = () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.');
};

type Fixture = {
  adminId: number;
  secondAdminId: number;
  roleId: number;
  updatePermissionId: number;
  readPermissionId: number;
  gymTypeId: number;
  trainerTypeId: number;
  basicTypeId: number;
  gymPlanId: number;
  trainerPlanId: number;
  gymMemberId: number;
  trainerMemberId: number;
  rejectMemberId: number;
  gymRequestId: number;
  gymPaymentId: number;
  trainerRequestId: number;
  trainerPaymentId: number;
  rejectRequestId: number;
  rejectPaymentId: number;
  acceptedRequestId: number;
  acceptedPaymentId: number;
  declinedRequestId: number;
  declinedPaymentId: number;
  raceRequestId: number;
  racePaymentOneId: number;
  racePaymentTwoId: number;
  unrelatedPaymentId: number;
};

const seed = async (): Promise<Fixture> => {
  assertIsolated();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Notification", "Payment", "MemberRequest", "MemberPlan", "PlanDuration", "MemberType", "MemberProfile", "Member", "BankInformation", "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE');
  const createdPermissions = await Promise.all(permissions.map((name) => prisma.permission.create({ data: { name, description: `Synthetic ${name}` } })));
  const role = await prisma.role.create({ data: { name: 'Synthetic Request Role' } });
  await prisma.rolePermission.createMany({ data: createdPermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
  const [admin, secondAdmin] = await Promise.all([
    prisma.user.create({ data: { name: 'Request Admin', email: 'request.admin@example.test', username: 'request-admin', password: 'hash' } }),
    prisma.user.create({ data: { name: 'Second Admin', email: 'request.admin2@example.test', username: 'request-admin-2', password: 'hash' } }),
  ]);
  await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: role.id }, { userId: secondAdmin.id, roleId: role.id }] });

  const [basicType, gymType, trainerType] = await Promise.all([
    prisma.memberType.create({ data: { name: 'Synthetic Basic' } }),
    prisma.memberType.create({ data: { name: 'Synthetic Gym' } }),
    prisma.memberType.create({ data: { name: 'Synthetic Coach' } }),
  ]);
  const duration = await prisma.planDuration.create({ data: { name: 'Three Months', value: 3 } });
  const [gymPlan, trainerPlan] = await Promise.all([
    prisma.memberPlan.create({ data: { name: 'Synthetic Gym Plan', memberTypeId: gymType.id, durationId: duration.id, duration: 3, price: 3000 } }),
    prisma.memberPlan.create({ data: { name: 'Synthetic Trainer Plan', memberTypeId: trainerType.id, durationId: duration.id, duration: 3, price: 5000 } }),
  ]);
  const bank = await prisma.bankInformation.create({ data: { name: 'Synthetic Bank', bankAccountHolder: 'Private Holder', bankAccountNumber: '12345678', phone: '09123456789' } });
  const member = async (name: string, code: string) => prisma.member.create({ data: { name, code, password: 'hash', memberTypeId: basicType.id } });
  const [gymMember, trainerMember, rejectMember, acceptedMember, declinedMember, raceMember, unrelatedMember] = await Promise.all([
    member('Gym Member', 'REQ-GYM'), member('Trainer Member', 'REQ-TRAINER'), member('Reject Member', 'REQ-REJECT'),
    member('Accepted Member', 'REQ-ACCEPTED'), member('Declined Member', 'REQ-DECLINED'), member('Race Member', 'REQ-RACE'), member('Other Member', 'REQ-OTHER'),
  ]);
  await prisma.memberProfile.create({ data: { memberId: trainerMember.id, bio: 'Keep this bio', age: 18, yearOfExp: 0 } });

  const createRequest = (memberId: number, memberTypeId: number, memberPlanId: number, extra: Record<string, unknown> = {}) => prisma.memberRequest.create({ data: { memberId, memberTypeId, memberPlanId, status: MemberRequestStatus.PENDING, ...extra } });
  const [gymRequest, trainerRequest, rejectRequest, acceptedRequest, declinedRequest, raceRequest] = await Promise.all([
    createRequest(gymMember.id, gymType.id, gymPlan.id),
    createRequest(trainerMember.id, trainerType.id, trainerPlan.id, { age: 31, gender: 'FEMALE', yearOfExp: 7, reason: 'Coach safely', certificates: ['certificate-url'], photos: ['photo-url'] }),
    createRequest(rejectMember.id, gymType.id, gymPlan.id),
    createRequest(acceptedMember.id, gymType.id, gymPlan.id),
    createRequest(declinedMember.id, gymType.id, gymPlan.id),
    createRequest(raceMember.id, gymType.id, gymPlan.id),
  ]);
  const createPayment = (memberId: number, memberRequestId: number, memberTypeId: number, memberPlanId: number, status = PaymentStatus.DRAFT) => prisma.payment.create({ data: {
    name: `Payment ${memberRequestId}`, memberId, memberRequestId, memberTypeId, memberPlanId, requestType: PaymentRequestType.MEMBER_PLAN_UPGRADE,
    bankInformationId: bank.id, amount: memberPlanId === trainerPlan.id ? 5000 : 3000, attachment: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com/yc-fitness-uat/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png', status,
  } });
  const [gymPayment, trainerPayment, rejectPayment, acceptedPayment, declinedPayment, racePaymentOne, racePaymentTwo] = await Promise.all([
    createPayment(gymMember.id, gymRequest.id, gymType.id, gymPlan.id),
    createPayment(trainerMember.id, trainerRequest.id, trainerType.id, trainerPlan.id),
    createPayment(rejectMember.id, rejectRequest.id, gymType.id, gymPlan.id),
    createPayment(acceptedMember.id, acceptedRequest.id, gymType.id, gymPlan.id, PaymentStatus.ACCEPT),
    createPayment(declinedMember.id, declinedRequest.id, gymType.id, gymPlan.id, PaymentStatus.DECLINE),
    createPayment(raceMember.id, raceRequest.id, gymType.id, gymPlan.id),
    createPayment(raceMember.id, raceRequest.id, gymType.id, gymPlan.id),
  ]);
  const unrelatedPayment = await prisma.payment.create({ data: { name: 'Unrelated', memberId: unrelatedMember.id, memberTypeId: gymType.id, memberPlanId: gymPlan.id, requestType: PaymentRequestType.MEMBER_PLAN_UPGRADE, bankInformationId: bank.id, amount: 3000, attachment: 'private-other-proof', status: PaymentStatus.DRAFT } });
  return {
    adminId: admin.id, secondAdminId: secondAdmin.id, roleId: role.id,
    updatePermissionId: createdPermissions.find((item) => item.name === 'member-request:update')!.id,
    readPermissionId: createdPermissions.find((item) => item.name === 'member-request:read')!.id,
    gymTypeId: gymType.id, trainerTypeId: trainerType.id, basicTypeId: basicType.id, gymPlanId: gymPlan.id, trainerPlanId: trainerPlan.id,
    gymMemberId: gymMember.id, trainerMemberId: trainerMember.id, rejectMemberId: rejectMember.id,
    gymRequestId: gymRequest.id, gymPaymentId: gymPayment.id,
    trainerRequestId: trainerRequest.id, trainerPaymentId: trainerPayment.id,
    rejectRequestId: rejectRequest.id, rejectPaymentId: rejectPayment.id,
    acceptedRequestId: acceptedRequest.id, acceptedPaymentId: acceptedPayment.id,
    declinedRequestId: declinedRequest.id, declinedPaymentId: declinedPayment.id,
    raceRequestId: raceRequest.id, racePaymentOneId: racePaymentOne.id, racePaymentTwoId: racePaymentTwo.id,
    unrelatedPaymentId: unrelatedPayment.id,
  };
};

const decisionState = async (requestId: number, paymentId: number) => {
  const prisma = getPrismaClient();
  return Promise.all([
    prisma.memberRequest.findUniqueOrThrow({ where: { id: requestId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    prisma.notification.findMany({ where: { resId: requestId, model: 'system' } }),
  ]);
};

describe('Membership Request isolated PostgreSQL integration', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await seed(); });
  afterAll(async () => { await disconnectDatabase(); });

  it('returns safe linked-payment summaries without attachment or bank credential leakage', async () => {
    const response = await request(app()).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}`).set(authorize(fixture.adminId));
    expect(response.status).toBe(200);
    expect(response.body.data.payments[0]).toMatchObject({ id: fixture.gymPaymentId, hasPaymentProof: true, structurallyMatches: true, paymentDestination: { name: 'Synthetic Bank', paymentType: 'BANK_ACCOUNT' } });
    const serialized = JSON.stringify(response.body);
    expect(response.body.data.payments[0]).toMatchObject({ paymentProofStatus: 'AVAILABLE', paymentProofPath: `/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof` });
    expect(serialized).not.toContain('digitaloceanspaces');
    expect(serialized).not.toContain('payment-attachments/');
    expect(serialized).not.toContain('12345678');
    expect(serialized).not.toContain('09123456789');
    expect(serialized).not.toContain('bankAccountHolder');
  });

  it('atomically approves a matching draft payment and performs idempotent replay without duplicate notifications', async () => {
    const first = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.gymPaymentId });
    const replay = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.secondAdminId)).send({ paymentId: fixture.gymPaymentId });
    const [membershipRequest, payment, notifications] = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    const member = await getPrismaClient().member.findUniqueOrThrow({ where: { id: fixture.gymMemberId }, include: { profile: true } });
    expect(first.body.data.changed).toBe(true);
    expect(replay.body.data.changed).toBe(false);
    expect(membershipRequest).toMatchObject({ status: MemberRequestStatus.APPROVED, approvedById: fixture.adminId, rejectedById: null, rejectedAt: null, rejectedReason: null });
    expect(membershipRequest.approvedAt).toBeInstanceOf(Date);
    expect(payment).toMatchObject({ status: PaymentStatus.ACCEPT, approvedById: fixture.adminId, cancelledById: null, cancelledAt: null, cancelledReason: null });
    expect(payment.approvedAt).toBeInstanceOf(Date);
    expect(member.memberTypeId).toBe(fixture.gymTypeId);
    expect(member.profile).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ toUserId: fixture.gymMemberId, type: 'SYSTEM', message: 'Your membership request has been approved.' });
  });

  it('updates trainer profile fields only for the trainer-shaped request and preserves unrelated profile data', async () => {
    const response = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.trainerRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.trainerPaymentId });
    const member = await getPrismaClient().member.findUniqueOrThrow({ where: { id: fixture.trainerMemberId }, include: { profile: true } });
    expect(response.status).toBe(200);
    expect(member.memberTypeId).toBe(fixture.trainerTypeId);
    expect(member.profile).toMatchObject({ bio: 'Keep this bio', age: 31, gender: 'FEMALE', yearOfExp: 7, reason: 'Coach safely', certificates: ['certificate-url'], photos: ['photo-url'] });
  });

  it('accepts historical ACCEPT payments, blocks DECLINE and unrelated payments, and preserves terminal states', async () => {
    const acceptedReject = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.acceptedRequestId}/reject`).set(authorize(fixture.adminId)).send({ paymentId: fixture.acceptedPaymentId, reason: 'Cannot reverse' });
    const historical = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.acceptedRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.acceptedPaymentId });
    const declined = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.declinedRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.declinedPaymentId });
    const unrelated = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.unrelatedPaymentId });
    const opposite = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.acceptedRequestId}/reject`).set(authorize(fixture.adminId)).send({ paymentId: fixture.acceptedPaymentId, reason: 'Too late' });
    expect(acceptedReject.body.error.code).toBe('MEMBERSHIP_PAYMENT_ACCEPTED');
    expect(historical.status).toBe(200);
    expect(declined.body.error.code).toBe('MEMBERSHIP_PAYMENT_DECLINED');
    expect(unrelated.body.error.code).toBe('MEMBERSHIP_PAYMENT_RELATIONSHIP_INVALID');
    expect(opposite.body.error.code).toBe('MEMBERSHIP_REQUEST_STATE_CONFLICT');
  });

  it('blocks individually mismatched member, plan, and member type relationships', async () => {
    const prisma = getPrismaClient();
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberId: fixture.trainerMemberId } });
    const wrongMember = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.gymPaymentId });
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberId: fixture.gymMemberId, memberPlanId: fixture.trainerPlanId } });
    const wrongPlan = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.gymPaymentId });
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberPlanId: fixture.gymPlanId, memberTypeId: fixture.trainerTypeId } });
    const wrongType = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.gymPaymentId });
    expect([wrongMember, wrongPlan, wrongType].map((response) => response.body.error.code)).toEqual([
      'MEMBERSHIP_PAYMENT_RELATIONSHIP_INVALID',
      'MEMBERSHIP_PAYMENT_RELATIONSHIP_INVALID',
      'MEMBERSHIP_PAYMENT_RELATIONSHIP_INVALID',
    ]);
  });

  it('atomically rejects, trims the reason, leaves member/profile unchanged, and replays idempotently', async () => {
    const before = await getPrismaClient().member.findUniqueOrThrow({ where: { id: fixture.rejectMemberId }, include: { profile: true } });
    const first = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.rejectRequestId}/reject`).set(authorize(fixture.adminId)).send({ paymentId: fixture.rejectPaymentId, reason: '  Proof is unreadable.  ' });
    const replay = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.rejectRequestId}/reject`).set(authorize(fixture.secondAdminId)).send({ paymentId: fixture.rejectPaymentId, reason: 'Different replay text' });
    const [membershipRequest, payment, notifications] = await decisionState(fixture.rejectRequestId, fixture.rejectPaymentId);
    const after = await getPrismaClient().member.findUniqueOrThrow({ where: { id: fixture.rejectMemberId }, include: { profile: true } });
    expect(first.body.data.changed).toBe(true);
    expect(replay.body.data.changed).toBe(false);
    expect(membershipRequest).toMatchObject({ status: MemberRequestStatus.REJECTED, rejectedById: fixture.adminId, rejectedReason: 'Proof is unreadable.', approvedById: null, approvedAt: null });
    expect(payment).toMatchObject({ status: PaymentStatus.DECLINE, cancelledById: fixture.adminId, cancelledReason: 'Proof is unreadable.', approvedById: null, approvedAt: null });
    expect(after.memberTypeId).toBe(before.memberTypeId);
    expect(after.profile).toEqual(before.profile);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe('Your membership request has been rejected.');
    const opposite = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.rejectRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.rejectPaymentId });
    expect(opposite.body.error.code).toBe('MEMBERSHIP_REQUEST_STATE_CONFLICT');
  });

  it('requires current update permission on every decision request', async () => {
    await getPrismaClient().rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.roleId, permissionId: fixture.updatePermissionId } } });
    const response = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.gymPaymentId });
    expect(response.status).toBe(403);
    const [membershipRequest, payment] = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    expect(membershipRequest.status).toBe(MemberRequestStatus.PENDING);
    expect(payment.status).toBe(PaymentStatus.DRAFT);
  });

  it('requires current read permission for proof and preserves the System Admin bypass', async () => {
    const prisma = getPrismaClient();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) };
    const repository = new PrismaMembershipRequestRepository();
    const service = testProofService(repository, fetcher);
    const beforeRevocation = await request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.adminId));
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.roleId, permissionId: fixture.readPermissionId } } });
    const forbidden = await request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.adminId));
    const systemRole = await prisma.role.create({ data: { name: 'SuperAdmin' } });
    await prisma.userRole.create({ data: { userId: fixture.secondAdminId, roleId: systemRole.id } });
    const bypass = await request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.secondAdminId));
    expect(beforeRevocation.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(bypass.status).toBe(200);
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  it('streams normalized canonical proof with safe headers and never exposes the stored URL', async () => {
    const prisma = getPrismaClient();
    const before = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) };
    const normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => Buffer.from('normalized-test-webp')) };
    const repository = new PrismaMembershipRequestRepository();
    const response = await request(app(testProofService(repository, fetcher, normalizer))).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.adminId));
    const after = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({ 'content-type': 'image/webp', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store, max-age=0' });
    expect(fetcher.fetch).toHaveBeenCalledWith('https://yc-fitness-uat.sgp1.digitaloceanspaces.com/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png');
    expect(JSON.stringify(response.body)).not.toContain('digitaloceanspaces');
    expect(after).toEqual(before);
    expect(await prisma.notification.count({ where: { resId: fixture.gymRequestId } })).toBe(0);
  });

  it('blocks every inconsistent request/payment relationship before proof fetch', async () => {
    const prisma = getPrismaClient();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) };
    const repository = new PrismaMembershipRequestRepository();
    const service = testProofService(repository, fetcher);
    const proof = () => request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.adminId));

    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberId: fixture.trainerMemberId } });
    expect((await proof()).status).toBe(404);
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberId: fixture.gymMemberId, memberPlanId: fixture.trainerPlanId } });
    expect((await proof()).status).toBe(404);
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberPlanId: fixture.gymPlanId, memberTypeId: fixture.trainerTypeId } });
    expect((await proof()).status).toBe(404);
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { memberTypeId: fixture.gymTypeId, memberRequestId: fixture.trainerRequestId } });
    expect((await proof()).status).toBe(404);
    const unrelated = await request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.unrelatedPaymentId}/proof`).set(authorize(fixture.adminId));
    expect(unrelated.status).toBe(404);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it('requires the exact selected payment when multiple payments are linked', async () => {
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) };
    const repository = new PrismaMembershipRequestRepository();
    const service = testProofService(repository, fetcher);
    const first = await request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.raceRequestId}/payments/${fixture.racePaymentOneId}/proof`).set(authorize(fixture.adminId));
    const second = await request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.raceRequestId}/payments/${fixture.racePaymentTwoId}/proof`).set(authorize(fixture.adminId));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects local, legacy, and missing attachment values without network activity', async () => {
    const prisma = getPrismaClient();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) };
    const repository = new PrismaMembershipRequestRepository();
    const service = testProofService(repository, fetcher);
    const proof = () => request(app(service)).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.adminId));
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { attachment: 'http://localhost:3030/public/uploads/payment-attachments/proof.png' } });
    const local = await proof();
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { attachment: 'private-storage-key-only' } });
    const legacy = await proof();
    await prisma.payment.update({ where: { id: fixture.gymPaymentId }, data: { attachment: '' } });
    const missing = await proof();
    expect(local.body.error).toMatchObject({ code: 'PAYMENT_PROOF_UNSUPPORTED' });
    expect(legacy.body.error).toMatchObject({ code: 'PAYMENT_PROOF_UNSUPPORTED' });
    expect(missing.body.error).toMatchObject({ code: 'PAYMENT_PROOF_NOT_FOUND' });
    expect(JSON.stringify([local.body, legacy.body, missing.body])).not.toMatch(/localhost|private-storage|attachment|payment-attachments/);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it('does not mutate decision state when trusted proof retrieval fails', async () => {
    const before = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => { throw new PaymentProofFetchFailure('UPSTREAM'); }) };
    const repository = new PrismaMembershipRequestRepository();
    const response = await request(app(testProofService(repository, fetcher))).get(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/payments/${fixture.gymPaymentId}/proof`).set(authorize(fixture.adminId));
    const after = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('PAYMENT_PROOF_UPSTREAM_UNAVAILABLE');
    expect(after).toEqual(before);
  });

  it('allows only one winner in approve/reject and different-payment races', async () => {
    const approve = request(app()).post(`/api/admin/v1/membership-requests/${fixture.raceRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.racePaymentOneId });
    const reject = request(app()).post(`/api/admin/v1/membership-requests/${fixture.raceRequestId}/reject`).set(authorize(fixture.secondAdminId)).send({ paymentId: fixture.racePaymentOneId, reason: 'Concurrent rejection' });
    const results = await Promise.all([approve, reject]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const finalRequest = await getPrismaClient().memberRequest.findUniqueOrThrow({ where: { id: fixture.raceRequestId } });
    const finalPayment = await getPrismaClient().payment.findUniqueOrThrow({ where: { id: fixture.racePaymentOneId } });
    expect(finalRequest.status === MemberRequestStatus.APPROVED ? finalPayment.status : PaymentStatus.DECLINE).toBe(finalPayment.status);
    expect(await getPrismaClient().notification.count({ where: { resId: fixture.raceRequestId } })).toBe(1);

    fixture = await seed();
    const twoApprovals = await Promise.all([
      request(app()).post(`/api/admin/v1/membership-requests/${fixture.raceRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.racePaymentOneId }),
      request(app()).post(`/api/admin/v1/membership-requests/${fixture.raceRequestId}/approve`).set(authorize(fixture.secondAdminId)).send({ paymentId: fixture.racePaymentTwoId }),
    ]);
    expect(twoApprovals.map((result) => result.status).sort()).toEqual([200, 409]);
    const payments = await getPrismaClient().payment.findMany({ where: { id: { in: [fixture.racePaymentOneId, fixture.racePaymentTwoId] } } });
    expect(payments.filter((payment) => payment.status === PaymentStatus.ACCEPT)).toHaveLength(1);
    expect(payments.filter((payment) => payment.status === PaymentStatus.DRAFT)).toHaveLength(1);
  });

  it('serializes a standalone payment decline racing membership approval', async () => {
    const membershipRepository = new PrismaMembershipRequestRepository();
    const paymentRepository = new PrismaPaymentRepository();
    const results = await Promise.allSettled([
      membershipRepository.approve({ requestId: fixture.gymRequestId, paymentId: fixture.gymPaymentId, actorUserId: fixture.adminId }),
      paymentRepository.decide({ paymentId: fixture.gymPaymentId, actorUserId: fixture.secondAdminId, decision: 'decline', reason: 'Standalone decline' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [membershipRequest, payment] = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
    if (membershipRequest.status === MemberRequestStatus.APPROVED) expect(payment.status).toBe(PaymentStatus.ACCEPT);
    else {
      expect(membershipRequest.status).toBe(MemberRequestStatus.PENDING);
      expect(payment.status).toBe(PaymentStatus.DECLINE);
    }
  });

  it('rolls back payment, request, member, and notification writes when any later transaction stage fails', async () => {
    const prisma = getPrismaClient();
    const failures = [
      { table: 'Payment', event: 'UPDATE' },
      { table: 'MemberRequest', event: 'UPDATE' },
      { table: 'Member', event: 'UPDATE' },
      { table: 'Notification', event: 'INSERT' },
    ];
    for (const [index, failure] of failures.entries()) {
      if (index > 0) fixture = await seed();
      const functionName = `fail_membership_decision_${index}`;
      const triggerName = `fail_membership_decision_trigger_${index}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic decision failure'; END; $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE ${failure.event} ON "${failure.table}" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
      try {
        const response = await request(app()).post(`/api/admin/v1/membership-requests/${fixture.gymRequestId}/approve`).set(authorize(fixture.adminId)).send({ paymentId: fixture.gymPaymentId });
        expect(response.status).toBe(500);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "${failure.table}"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
      }
      const [membershipRequest, payment, notifications] = await decisionState(fixture.gymRequestId, fixture.gymPaymentId);
      const member = await prisma.member.findUniqueOrThrow({ where: { id: fixture.gymMemberId } });
      expect(membershipRequest.status).toBe(MemberRequestStatus.PENDING);
      expect(payment.status).toBe(PaymentStatus.DRAFT);
      expect(member.memberTypeId).toBe(fixture.basicTypeId);
      expect(notifications).toHaveLength(0);
    }
  });
});
