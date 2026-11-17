import type { Request, Response } from 'express';

import { sendCollection } from '../../shared/api-response.js';
import type { MemberDirectoryService } from './member-directory.service.js';
import type { MemberDirectoryQueryInput } from './member-directory.schema.js';

export class MemberDirectoryController {
  public constructor(private readonly service: MemberDirectoryService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as MemberDirectoryQueryInput;
    const memberDirectoryQuery = {
      name: query.name,
      contact: query.contact,
      limit: query.limit,
      offset: query.offset,
    };
    const result = await this.service.list(memberDirectoryQuery);
    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.limit);

    return sendCollection(response, result.data, {
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      currentPage: Math.floor(query.offset / query.limit) + 1,
      totalPages,
    });
  };
}
