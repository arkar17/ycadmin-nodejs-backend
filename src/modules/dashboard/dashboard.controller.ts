import type { Request, Response } from 'express';

import { sendData } from '../../shared/api-response.js';
import type { DashboardOverviewQuery } from './dashboard.schema.js';
import type { DashboardService } from './dashboard.service.js';

export class DashboardController {
  public constructor(private readonly service: DashboardService) {}

  public readonly overview = async (request: Request, response: Response) =>
    sendData(response, await this.service.overview(request.validated?.query as DashboardOverviewQuery));
}
