import type { Request, Response } from 'express';

import { sendData } from '../../shared/api-response.js';
import type { MemberUpdateInput } from './member-management.schema.js';
import type { MemberManagementService } from './member-management.service.js';

export class MemberManagementController {
  public constructor(private readonly service: MemberManagementService) {}

  public readonly detail = async (request: Request, response: Response) =>
    sendData(response, await this.service.detail(Number(request.params.id)));

  public readonly update = async (request: Request, response: Response) =>
    sendData(response, await this.service.update(
      Number(request.params.id),
      request.auth!.userId,
      request.body as MemberUpdateInput,
    ));

  public readonly activate = async (request: Request, response: Response) =>
    sendData(response, await this.service.activate(Number(request.params.id), request.auth!.userId));

  public readonly deactivate = async (request: Request, response: Response) =>
    sendData(response, await this.service.deactivate(Number(request.params.id), request.auth!.userId));
}
