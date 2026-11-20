import type { Request, Response } from 'express';

import { sendCollection, sendData } from '../../shared/api-response.js';
import type { PaymentDeclineInput, PaymentListQuery } from './payment.schema.js';
import type { PaymentService } from './payment.service.js';
import { sendPaymentProof } from '../payment-proof/payment-proof.response.js';

const requestIdFor = (request: Request) => request.id === undefined ? crypto.randomUUID() : String(request.id);

export class PaymentController {
  public constructor(private readonly service: PaymentService) {}

  public readonly list = async (request: Request, response: Response) => {
    const query = request.validated?.query as PaymentListQuery;
    const result = await this.service.list(query);
    return sendCollection(response, result.data, {
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      currentPage: Math.floor(query.offset / query.limit) + 1,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit),
    });
  };

  public readonly detail = async (request: Request, response: Response) =>
    sendData(response, await this.service.detail((request.validated?.params as { id: number }).id));

  public readonly proof = async (request: Request, response: Response) =>
    sendPaymentProof(response, await this.service.proof((request.validated?.params as { id: number }).id));

  public readonly accept = async (request: Request, response: Response) =>
    sendData(response, await this.service.accept(
      (request.validated?.params as { id: number }).id,
      request.auth!.userId,
      requestIdFor(request),
    ));

  public readonly decline = async (request: Request, response: Response) =>
    sendData(response, await this.service.decline(
      (request.validated?.params as { id: number }).id,
      request.auth!.userId,
      (request.body as PaymentDeclineInput).reason,
      requestIdFor(request),
    ));
}
