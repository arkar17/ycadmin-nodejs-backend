import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { RbacMutationContext } from '../admin-rbac/rbac-mutation.service.js';
import type { AdminRoleManagementService } from './admin-role-management.service.js';
import type { AdminRoleCreateInput, AdminRoleListQuery, AdminRoleUpdateInput } from './admin-role.schema.js';
import type { AdminRoleService } from './admin-role.service.js';

const mutationContext = (request: Request): RbacMutationContext => ({
  requestId: request.id === undefined ? crypto.randomUUID() : String(request.id),
  actorUserId: request.auth!.userId,
});

export class AdminRoleController {
  public constructor(
    private readonly service: AdminRoleService,
    private readonly management?: AdminRoleManagementService,
  ) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as AdminRoleListQuery;
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
    sendData(response, await this.management!.create(mutationContext(request), request.body as AdminRoleCreateInput), 201);

  public readonly update = async (request: Request, response: Response) =>
    sendData(response, await this.management!.update(
      mutationContext(request),
      (request.validated?.params as { id: number }).id,
      request.body as AdminRoleUpdateInput,
    ));

  public readonly activate = async (request: Request, response: Response) =>
    sendData(response, await this.management!.activate(mutationContext(request), (request.validated?.params as { id: number }).id));

  public readonly deactivate = async (request: Request, response: Response) =>
    sendData(response, await this.management!.deactivate(mutationContext(request), (request.validated?.params as { id: number }).id));

  public readonly assignPermission = async (request: Request, response: Response) => {
    const params = request.validated?.params as { id: number; permissionId: number };
    return sendData(response, await this.management!.assignPermission(mutationContext(request), params.id, params.permissionId));
  };

  public readonly removePermission = async (request: Request, response: Response) => {
    const params = request.validated?.params as { id: number; permissionId: number };
    return sendData(response, await this.management!.removePermission(mutationContext(request), params.id, params.permissionId));
  };

  public readonly replacePermissions = async (request: Request, response: Response) =>
    sendData(response, await this.management!.replacePermissions(
      mutationContext(request),
      (request.validated?.params as { id: number }).id,
      (request.body as { permissionIds: number[] }).permissionIds,
    ));
}
