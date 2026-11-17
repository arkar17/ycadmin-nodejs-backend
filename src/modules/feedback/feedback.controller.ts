import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { FeedbackDetailParamsInput, FeedbackListQueryInput } from './feedback.schema.js';
import type { FeedbackService } from './feedback.service.js';

export class FeedbackController {
  public constructor(private readonly service: FeedbackService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as FeedbackListQueryInput;
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
    const params = request.validated?.params as FeedbackDetailParamsInput;
    return sendData(response, await this.service.detail(params.id));
  };
}
