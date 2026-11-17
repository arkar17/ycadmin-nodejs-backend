import type { Request, Response } from 'express';

import { sendData } from '../../shared/api-response.js';
import type { AdminLoginInput } from './admin-login.schema.js';
import type { AdminLoginService } from './admin-login.service.js';

export class AdminLoginController {
  public constructor(private readonly service: AdminLoginService) {}

  public readonly login = async (request: Request, response: Response) =>
    sendData(response, await this.service.login(request.validated?.body as AdminLoginInput));
}
