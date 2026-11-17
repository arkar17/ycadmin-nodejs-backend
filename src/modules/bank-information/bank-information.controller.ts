import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { BankInformationCreateInput, BankInformationListQuery, BankInformationUpdateInput } from './bank-information.schema.js';
import type { BankInformationService } from './bank-information.service.js';

export class BankInformationController {
  public constructor(private readonly service: BankInformationService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as BankInformationListQuery;
    const result = await this.service.list(query);
    return sendCollection(response, result.data, { total: result.total, limit: query.limit, offset: query.offset, currentPage: Math.floor(query.offset / query.limit) + 1, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) });
  };

  public readonly detail = async (request: Request, response: Response) => sendData(response, await this.service.detail((request.validated?.params as { id: number }).id));
  public readonly create = async (request: Request, response: Response) => sendData(response, await this.service.create(request.validated?.body as BankInformationCreateInput, request.auth!.userId), 201);
  public readonly update = async (request: Request, response: Response) => sendData(response, await this.service.update((request.validated?.params as { id: number }).id, request.validated?.body as BankInformationUpdateInput, request.auth!.userId));
  public readonly remove = async (request: Request, response: Response) => { await this.service.remove((request.validated?.params as { id: number }).id); return response.status(204).send(); };
}
