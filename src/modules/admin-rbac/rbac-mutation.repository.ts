import { Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import {
  isActiveSystemAdminMembership,
  type RbacAdminUserProfile,
  type RbacPermissionState,
  type RbacRoleState,
  type RbacRoleProfile,
  type RbacUserState,
} from './rbac-mutation-policy.js';
import { runWithSerializableRetry } from './serializable-transaction.js';

export interface RbacMutationTransaction {
  findUser(id: number): Promise<RbacUserState | null>;
  findUserProfile(id: number): Promise<RbacAdminUserProfile | null>;
  findUserIdentityConflict(email: string, username: string, excludeUserId?: number): Promise<'email' | 'username' | null>;
  findRole(id: number): Promise<RbacRoleState | null>;
  findRoleProfile(id: number): Promise<RbacRoleProfile | null>;
  findRoleNameConflict(name: string, excludeRoleId?: number): Promise<boolean>;
  findRoles(ids: readonly number[]): Promise<RbacRoleState[]>;
  findPermission(id: number): Promise<RbacPermissionState | null>;
  findPermissions(ids: readonly number[]): Promise<RbacPermissionState[]>;
  countActiveSystemAdmins(): Promise<number>;
  listUserRoleIds(userId: number): Promise<number[]>;
  hasUserRole(userId: number, roleId: number): Promise<boolean>;
  createUserRole(userId: number, roleId: number): Promise<boolean>;
  deleteUserRole(userId: number, roleId: number): Promise<boolean>;
  replaceUserRoles(userId: number, roleIds: readonly number[]): Promise<void>;
  updateUserStatus(userId: number, status: Status, updatedById: number): Promise<void>;
  createAdminUser(input: {
    name: string;
    email: string;
    username: string;
    passwordHash: string;
    status: Status;
    roleIds: readonly number[];
    createdById: number;
  }): Promise<number>;
  updateAdminUserProfile(
    userId: number,
    input: { name?: string; email?: string; username?: string },
    updatedById: number,
  ): Promise<void>;
  createAdminRole(input: {
    name: string;
    description: string | null;
    status: Status;
    permissionIds: readonly number[];
    createdById: number;
  }): Promise<number>;
  updateAdminRole(
    roleId: number,
    input: { name?: string; description?: string | null },
    updatedById: number,
  ): Promise<void>;
  updateRoleStatus(roleId: number, status: Status, updatedById: number): Promise<void>;
  listRolePermissionIds(roleId: number): Promise<number[]>;
  replaceRolePermissions(roleId: number, permissionIds: readonly number[]): Promise<void>;
  hasRolePermission(roleId: number, permissionId: number): Promise<boolean>;
  createRolePermission(roleId: number, permissionId: number): Promise<boolean>;
  deleteRolePermission(roleId: number, permissionId: number): Promise<boolean>;
}

export interface RbacMutationRepository {
  executeSerializable<T>(operation: (transaction: RbacMutationTransaction) => Promise<T>): Promise<T>;
}

class PrismaRbacMutationTransaction implements RbacMutationTransaction {
  public constructor(private readonly transaction: Prisma.TransactionClient) {}

  public async findUser(id: number): Promise<RbacUserState | null> {
    const user = await this.transaction.user.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        roles: {
          where: { role: { name: SYSTEM_ADMIN_ROLE_NAME, status: Status.ACTIVE } },
          select: { role: { select: { name: true, status: true } } },
          take: 1,
        },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      status: user.status,
      isActiveSystemAdmin: isActiveSystemAdminMembership(
        user.status,
        user.roles.map(({ role }) => role),
      ),
    };
  }

  public async findUserProfile(id: number): Promise<RbacAdminUserProfile | null> {
    return this.transaction.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, username: true, status: true },
    });
  }

  public async findUserIdentityConflict(
    email: string,
    username: string,
    excludeUserId?: number,
  ): Promise<'email' | 'username' | null> {
    const user = await this.transaction.user.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { username: { equals: username, mode: 'insensitive' } },
        ],
        ...(excludeUserId === undefined ? {} : { NOT: { id: excludeUserId } }),
      },
      select: { email: true, username: true },
    });
    if (!user) return null;
    return user.email.toLowerCase() === email.toLowerCase() ? 'email' : 'username';
  }

  public async findRole(id: number): Promise<RbacRoleState | null> {
    return this.transaction.role.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  }

  public async findRoleProfile(id: number): Promise<RbacRoleProfile | null> {
    return this.transaction.role.findUnique({
      where: { id },
      select: { id: true, name: true, description: true, status: true },
    });
  }

  public async findRoleNameConflict(name: string, excludeRoleId?: number): Promise<boolean> {
    return (await this.transaction.role.count({
      where: { name, ...(excludeRoleId === undefined ? {} : { NOT: { id: excludeRoleId } }) },
    })) > 0;
  }

  public async findRoles(ids: readonly number[]): Promise<RbacRoleState[]> {
    if (ids.length === 0) return [];
    return this.transaction.role.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, status: true },
    });
  }

  public async findPermission(id: number): Promise<RbacPermissionState | null> {
    return this.transaction.permission.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
  }

  public async findPermissions(ids: readonly number[]): Promise<RbacPermissionState[]> {
    if (ids.length === 0) return [];
    return this.transaction.permission.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, status: true },
    });
  }

  public async countActiveSystemAdmins(): Promise<number> {
    return this.transaction.user.count({
      where: {
        status: Status.ACTIVE,
        roles: { some: { role: { name: SYSTEM_ADMIN_ROLE_NAME, status: Status.ACTIVE } } },
      },
    });
  }

  public async listUserRoleIds(userId: number): Promise<number[]> {
    const assignments = await this.transaction.userRole.findMany({
      where: { userId },
      select: { roleId: true },
      orderBy: { roleId: 'asc' },
    });
    return assignments.map(({ roleId }) => roleId);
  }

  public async hasUserRole(userId: number, roleId: number): Promise<boolean> {
    return (await this.transaction.userRole.count({ where: { userId, roleId } })) > 0;
  }

  public async createUserRole(userId: number, roleId: number): Promise<boolean> {
    const result = await this.transaction.userRole.createMany({ data: [{ userId, roleId }], skipDuplicates: true });
    return result.count === 1;
  }

  public async deleteUserRole(userId: number, roleId: number): Promise<boolean> {
    const result = await this.transaction.userRole.deleteMany({ where: { userId, roleId } });
    return result.count === 1;
  }

  public async replaceUserRoles(userId: number, roleIds: readonly number[]): Promise<void> {
    await this.transaction.userRole.deleteMany({ where: { userId } });
    if (roleIds.length > 0) {
      await this.transaction.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })) });
    }
  }

  public async updateUserStatus(userId: number, status: Status, updatedById: number): Promise<void> {
    await this.transaction.user.update({ where: { id: userId }, data: { status, updatedById } });
  }

  public async createAdminUser(input: {
    name: string;
    email: string;
    username: string;
    passwordHash: string;
    status: Status;
    roleIds: readonly number[];
    createdById: number;
  }): Promise<number> {
    const user = await this.transaction.user.create({
      data: {
        name: input.name,
        email: input.email,
        username: input.username,
        password: input.passwordHash,
        status: input.status,
        createdById: input.createdById,
      },
      select: { id: true },
    });
    await this.transaction.userRole.createMany({
      data: input.roleIds.map((roleId) => ({ userId: user.id, roleId })),
    });
    return user.id;
  }

  public async updateAdminUserProfile(
    userId: number,
    input: { name?: string; email?: string; username?: string },
    updatedById: number,
  ): Promise<void> {
    await this.transaction.user.update({ where: { id: userId }, data: { ...input, updatedById } });
  }

  public async createAdminRole(input: {
    name: string;
    description: string | null;
    status: Status;
    permissionIds: readonly number[];
    createdById: number;
  }): Promise<number> {
    const role = await this.transaction.role.create({
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        createdById: input.createdById,
      },
      select: { id: true },
    });
    if (input.permissionIds.length > 0) {
      await this.transaction.rolePermission.createMany({
        data: input.permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
    return role.id;
  }

  public async updateAdminRole(
    roleId: number,
    input: { name?: string; description?: string | null },
    updatedById: number,
  ): Promise<void> {
    await this.transaction.role.update({ where: { id: roleId }, data: { ...input, updatedById } });
  }

  public async updateRoleStatus(roleId: number, status: Status, updatedById: number): Promise<void> {
    await this.transaction.role.update({ where: { id: roleId }, data: { status, updatedById } });
  }

  public async listRolePermissionIds(roleId: number): Promise<number[]> {
    const assignments = await this.transaction.rolePermission.findMany({
      where: { roleId },
      select: { permissionId: true },
      orderBy: { permissionId: 'asc' },
    });
    return assignments.map(({ permissionId }) => permissionId);
  }

  public async replaceRolePermissions(roleId: number, permissionIds: readonly number[]): Promise<void> {
    await this.transaction.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await this.transaction.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }
  }

  public async hasRolePermission(roleId: number, permissionId: number): Promise<boolean> {
    return (await this.transaction.rolePermission.count({ where: { roleId, permissionId } })) > 0;
  }

  public async createRolePermission(roleId: number, permissionId: number): Promise<boolean> {
    const result = await this.transaction.rolePermission.createMany({ data: [{ roleId, permissionId }], skipDuplicates: true });
    return result.count === 1;
  }

  public async deleteRolePermission(roleId: number, permissionId: number): Promise<boolean> {
    const result = await this.transaction.rolePermission.deleteMany({ where: { roleId, permissionId } });
    return result.count === 1;
  }
}

export class PrismaRbacMutationRepository implements RbacMutationRepository {
  public constructor(private readonly onSerializableRetry?: (attempt: number, error: unknown) => void) {}

  public async executeSerializable<T>(operation: (transaction: RbacMutationTransaction) => Promise<T>): Promise<T> {
    const prisma = getPrismaClient();
    return runWithSerializableRetry(() => prisma.$transaction(
      (transaction) => operation(new PrismaRbacMutationTransaction(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ), undefined, this.onSerializableRetry);
  }
}
