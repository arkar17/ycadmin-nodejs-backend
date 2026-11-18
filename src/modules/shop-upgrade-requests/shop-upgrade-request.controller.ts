import type { Request, Response } from 'express';
import { sendCollection, sendData } from '../../shared/api-response.js';
import { sendPaymentProof } from '../payment-proof/payment-proof.response.js';
import type { ShopUpgradeRequestListQuery } from './shop-upgrade-request.schema.js';
import type { ShopUpgradeRequestService } from './shop-upgrade-request.service.js';
export class ShopUpgradeRequestController {
  public constructor(private readonly service: ShopUpgradeRequestService) {}
  public readonly list = async (request: Request, response: Response) => { const query = request.validated!.query as ShopUpgradeRequestListQuery; const result = await this.service.list(query); return sendCollection(response, result.data, { total: result.total, limit: query.limit, offset: query.offset, currentPage: Math.floor(query.offset / query.limit) + 1, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) }); };
  public readonly detail = async (request: Request, response: Response) => sendData(response, await this.service.detail((request.validated!.params as { id: number }).id));
  public readonly proof = async (request: Request, response: Response) => { const { requestId, paymentId } = request.validated!.params as { requestId: number; paymentId: number }; return sendPaymentProof(response, await this.service.proof(requestId, paymentId)); };
  public readonly approve = async (request: Request, response: Response) => { const { id } = request.validated!.params as { id: number }; const { paymentId } = request.validated!.body as { paymentId: number }; return sendData(response, await this.service.approve(id, paymentId, request.auth!.userId)); };
  public readonly reject = async (request: Request, response: Response) => { const { id } = request.validated!.params as { id: number }; const { paymentId, reason } = request.validated!.body as { paymentId: number; reason: string }; return sendData(response, await this.service.reject(id, paymentId, reason, request.auth!.userId)); };
}
