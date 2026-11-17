import { Status } from '@prisma/client';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import {
  assertIsolatedIntegrationDatabaseUrl,
} from '../../tests/integration-database-safety.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import type { RbacMutationRepository, RbacMutationTransaction } from './rbac-mutation.repository.js';
import { PrismaRbacMutationRepository } from './rbac-mutation.repository.js';
import type { RbacSecurityAuditSink } from './rbac-security-audit.js';
import { RbacMutationService } from './rbac-mutation.service.js';

type Fixture = { firstUserId: number; secondUserId: number; systemRoleId: number };

class OneShotCountBarrier {
  private arrivals = 0;
  private readonly released: Promise<void>;
  private release!: () => void;

  public constructor() {
    this.released = new Promise((resolve) => { this.release = resolve; });
  }

  public async waitAfterInitialCount(): Promise<void> {
    if (this.arrivals >= 2) return;
    this.arrivals += 1;
    if (this.arrivals === 2) this.release();
    await this.released;
  }
}

class CountSynchronizedRepository implements RbacMutationRepository {
  public constructor(
    private readonly repository: RbacMutationRepository,
    private readonly barrier: OneShotCountBarrier,
  ) {}

  public executeSerializable<T>(operation: (transaction: RbacMutationTransaction) => Promise<T>): Promise<T> {
    return this.repository.executeSerializable((transaction) => {
      const synchronized = new Proxy(transaction, {
        get: (target, property, receiver) => {
          if (property === 'countActiveSystemAdmins') {
            return async () => {
              const count = await target.countActiveSystemAdmins();
              await this.barrier.waitAfterInitialCount();
              return count;
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return operation(synchronized);
    });
  }
}

const audit: RbacSecurityAuditSink = { record: () => undefined };

const resetFixture = async (): Promise<Fixture> => {
  assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
  );
  const systemRole = await prisma.role.create({ data: { name: SYSTEM_ADMIN_ROLE_NAME, status: Status.ACTIVE } });
  const normalRole = await prisma.role.create({ data: { name: 'Synthetic concurrency role', status: Status.ACTIVE } });
  const [first, second] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Concurrency Admin A',
        email: 'concurrency-a@example.test',
        username: 'concurrency-admin-a',
        password: 'synthetic-noncredential-hash',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Concurrency Admin B',
        email: 'concurrency-b@example.test',
        username: 'concurrency-admin-b',
        password: 'synthetic-noncredential-hash',
      },
    }),
  ]);
  await prisma.userRole.createMany({
    data: [
      { userId: first.id, roleId: systemRole.id },
      { userId: first.id, roleId: normalRole.id },
      { userId: second.id, roleId: systemRole.id },
      { userId: second.id, roleId: normalRole.id },
    ],
  });
  return { firstUserId: first.id, secondUserId: second.id, systemRoleId: systemRole.id };
};

const activeSystemAdminCount = () => getPrismaClient().user.count({
  where: {
    status: Status.ACTIVE,
    roles: { some: { role: { name: SYSTEM_ADMIN_ROLE_NAME, status: Status.ACTIVE } } },
  },
});

const concurrentServices = () => {
  const barrier = new OneShotCountBarrier();
  let retries = 0;
  const base = new PrismaRbacMutationRepository(() => { retries += 1; });
  const first = new RbacMutationService(new CountSynchronizedRepository(base, barrier), audit);
  const second = new RbacMutationService(new CountSynchronizedRepository(base, barrier), audit);
  return { first, second, retryCount: () => retries };
};

const assertOneSafeWinner = async (
  operations: [Promise<unknown>, Promise<unknown>],
  retryCount: () => number,
): Promise<void> => {
  const results = await Promise.allSettled(operations);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  expect(rejected?.reason).toMatchObject({
    code: expect.stringMatching(/^(SYSTEM_ADMIN_REQUIRED|LAST_SYSTEM_ADMIN_REQUIRED)$/),
  });
  expect(retryCount()).toBeGreaterThanOrEqual(1);
  expect(await activeSystemAdminCount()).toBe(1);
};

describe('System Admin serializable concurrency safety on isolated PostgreSQL', () => {
  let fixture: Fixture;

  beforeEach(async () => { fixture = await resetFixture(); });

  afterEach(async () => {
    assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
    await getPrismaClient().$executeRawUnsafe(
      'TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => { await disconnectDatabase(); });

  it('allows exactly one of two overlapping protected membership removals to commit', async () => {
    const services = concurrentServices();
    await assertOneSafeWinner([
      services.first.removeRole(
        { requestId: 'role-removal-a', actorUserId: fixture.firstUserId },
        fixture.secondUserId,
        fixture.systemRoleId,
      ),
      services.second.removeRole(
        { requestId: 'role-removal-b', actorUserId: fixture.secondUserId },
        fixture.firstUserId,
        fixture.systemRoleId,
      ),
    ], services.retryCount);
    expect(await getPrismaClient().userRole.count({ where: { roleId: fixture.systemRoleId } })).toBe(1);
  });

  it('allows exactly one of two overlapping System Admin deactivations to commit', async () => {
    const services = concurrentServices();
    await assertOneSafeWinner([
      services.first.deactivateUser(
        { requestId: 'deactivation-a', actorUserId: fixture.firstUserId },
        fixture.secondUserId,
      ),
      services.second.deactivateUser(
        { requestId: 'deactivation-b', actorUserId: fixture.secondUserId },
        fixture.firstUserId,
      ),
    ], services.retryCount);
    expect(await getPrismaClient().user.count({ where: { status: Status.ACTIVE } })).toBe(1);
  });

  it('preserves one active System Admin across mixed removal and deactivation', async () => {
    const services = concurrentServices();
    await assertOneSafeWinner([
      services.first.removeRole(
        { requestId: 'mixed-removal', actorUserId: fixture.firstUserId },
        fixture.secondUserId,
        fixture.systemRoleId,
      ),
      services.second.deactivateUser(
        { requestId: 'mixed-deactivation', actorUserId: fixture.secondUserId },
        fixture.firstUserId,
      ),
    ], services.retryCount);
  });
});
