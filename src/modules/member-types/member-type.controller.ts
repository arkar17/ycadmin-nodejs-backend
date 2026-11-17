import type { Request, Response } from 'express';

import { sendCollection } from '../../shared/api-response.js';
import type { MemberTypeListQuery } from './member-type.schema.js';
import type { MemberTypeService } from './member-type.service.js';

export class MemberTypeController {
  public constructor(private readonly service: MemberTypeService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as MemberTypeListQuery;
    const result = await this.service.list(query);
    return sendCollection(response, result.data, {
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      currentPage: Math.floor(query.offset / query.limit) + 1,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
    });
  };
}
