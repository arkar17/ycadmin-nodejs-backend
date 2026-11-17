import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { AdminPermissionListQuery } from './admin-permission.schema.js';
import type { AdminPermissionService } from './admin-permission.service.js';

export class AdminPermissionController {
  public constructor(private readonly service: AdminPermissionService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as AdminPermissionListQuery;
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
