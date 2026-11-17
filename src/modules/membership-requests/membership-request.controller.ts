import type { Request, Response } from 'express';
import { sendCollection, sendData } from '../../shared/api-response.js';
import type { MembershipRequestListQuery } from './membership-request.schema.js';
import type { MembershipRequestService } from './membership-request.service.js';

export class MembershipRequestController {
  public constructor(private readonly service: MembershipRequestService) {}
  public readonly list = async (request: Request, response: Response) => { const query = request.validated?.query as MembershipRequestListQuery; const result = await this.service.list(query); return sendCollection(response, result.data, { total: result.total, limit: query.limit, offset: query.offset, currentPage: Math.floor(query.offset / query.limit) + 1, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) }); };
  public readonly detail = async (request: Request, response: Response) => sendData(response, await this.service.detail((request.validated?.params as { id: number }).id));
}
