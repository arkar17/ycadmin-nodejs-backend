import type { Request, Response } from 'express';
import { sendCollection, sendData } from '../../shared/api-response.js';
import type { ShopListQuery } from './shop.schema.js';
import type { ShopService } from './shop.service.js';
export class ShopController {
  public constructor(private readonly service: ShopService) {}
  public readonly list = async (request: Request, response: Response) => { const query = request.validated!.query as ShopListQuery; const result = await this.service.list(query); return sendCollection(response, result.data, { total: result.total, limit: query.limit, offset: query.offset, currentPage: Math.floor(query.offset / query.limit) + 1, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) }); };
  public readonly detail = async (request: Request, response: Response) => sendData(response, await this.service.detail((request.validated!.params as { id: number }).id));
}
