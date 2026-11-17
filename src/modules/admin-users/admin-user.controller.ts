import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { RbacMutationContext } from '../admin-rbac/rbac-mutation.service.js';
import type { AdminUserManagementService } from './admin-user-management.service.js';
import type { AdminUserCreateInput, AdminUserListQuery, AdminUserUpdateInput } from './admin-user.schema.js';
import type { AdminUserService } from './admin-user.service.js';

const mutationContext = (request: Request): RbacMutationContext => ({
  requestId: request.id === undefined ? crypto.randomUUID() : String(request.id),
  actorUserId: request.auth!.userId,
});

export class AdminUserController {
  public constructor(
    private readonly service: AdminUserService,
    private readonly management?: AdminUserManagementService,
  ) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as AdminUserListQuery;
    const result = await this.service.list(query);
    return sendCollection(response, result.data, {
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      currentPage: Math.floor(query.offset / query.limit) + 1,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
    });
  };

  public readonly detail = async (request: Request, response: Response) =>
    sendData(response, await this.service.detail((request.validated?.params as { id: number }).id));

  public readonly create = async (request: Request, response: Response) =>
    sendData(
      response,
      await this.management!.create(mutationContext(request), request.body as AdminUserCreateInput),
      201,
    );

  public readonly update = async (request: Request, response: Response) =>
    sendData(response, await this.management!.update(
      mutationContext(request),
      (request.validated?.params as { id: number }).id,
      request.body as AdminUserUpdateInput,
    ));

  public readonly activate = async (request: Request, response: Response) =>
    sendData(response, await this.management!.activate(
      mutationContext(request),
      (request.validated?.params as { id: number }).id,
    ));

  public readonly deactivate = async (request: Request, response: Response) =>
    sendData(response, await this.management!.deactivate(
      mutationContext(request),
      (request.validated?.params as { id: number }).id,
    ));

  public readonly assignRole = async (request: Request, response: Response) =>
    sendData(response, await this.management!.assignRole(
      mutationContext(request),
      (request.validated?.params as { id: number; roleId: number }).id,
      (request.validated?.params as { id: number; roleId: number }).roleId,
    ));

  public readonly removeRole = async (request: Request, response: Response) =>
    sendData(response, await this.management!.removeRole(
      mutationContext(request),
      (request.validated?.params as { id: number; roleId: number }).id,
      (request.validated?.params as { id: number; roleId: number }).roleId,
    ));

  public readonly replaceRoles = async (request: Request, response: Response) =>
    sendData(response, await this.management!.replaceRoles(
      mutationContext(request),
      (request.validated?.params as { id: number }).id,
      (request.body as { roleIds: number[] }).roleIds,
    ));
}
