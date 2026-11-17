import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { PlanDurationCreateInput, PlanDurationListQuery, PlanDurationUpdateInput } from './plan-duration.schema.js';
import type { PlanDurationService } from './plan-duration.service.js';

export class PlanDurationController {
  public constructor(private readonly service: PlanDurationService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as PlanDurationListQuery;
    const result = await this.service.list(query);
    return sendCollection(response, result.data, {
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      currentPage: Math.floor(query.offset / query.limit) + 1,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
    });
  };

  public readonly create = async (request: Request, response: Response) => sendData(response, await this.service.create(request.validated?.body as PlanDurationCreateInput), 201);

  public readonly update = async (request: Request, response: Response) => {
    const id = (request.validated?.params as { id: number }).id;
    return sendData(response, await this.service.update(id, request.validated?.body as PlanDurationUpdateInput));
  };

  public readonly remove = async (request: Request, response: Response) => {
    const id = (request.validated?.params as { id: number }).id;
    await this.service.remove(id);
    return response.status(204).send();
  };
}
