import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { AdminRoleListQuery } from './admin-role.schema.js';
import type { AdminRoleService } from './admin-role.service.js';

export class AdminRoleController {
  public constructor(private readonly service: AdminRoleService) {}

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
}
