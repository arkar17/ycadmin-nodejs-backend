import type { Request, Response } from 'express';

import { sendData } from '../../shared/api-response.js';
import type { CurrentAdminService } from './current-admin.service.js';

export class CurrentAdminController {
  public constructor(private readonly service: CurrentAdminService) {}

  public readonly me = async (request: Request, response: Response) =>
    sendData(response, await this.service.get(request.auth!.userId));
}
