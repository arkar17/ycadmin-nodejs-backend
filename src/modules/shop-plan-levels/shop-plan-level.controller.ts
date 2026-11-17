import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { ShopPlanLevelDetailParams, ShopPlanLevelListQuery } from './shop-plan-level.schema.js';
import type { ShopPlanLevelService } from './shop-plan-level.service.js';

export class ShopPlanLevelController {
  public constructor(private readonly service: ShopPlanLevelService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as ShopPlanLevelListQuery;
    const result = await this.service.list(query);
    return sendCollection(response, result.data, {
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      currentPage: Math.floor(query.offset / query.limit) + 1,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
    });
  };

  public readonly detail = async (request: Request, response: Response) => {
    const params = request.validated?.params as ShopPlanLevelDetailParams;
    return sendData(response, await this.service.detail(params.id));
  };
}
