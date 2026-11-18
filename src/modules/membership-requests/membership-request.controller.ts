import type { Request, Response } from 'express';
import { sendCollection, sendData } from '../../shared/api-response.js';
import type { MembershipRequestListQuery } from './membership-request.schema.js';
import type { MembershipRequestApproveInput, MembershipRequestRejectInput } from './membership-request.schema.js';
import type { MembershipRequestService } from './membership-request.service.js';
import { sendPaymentProof } from '../payment-proof/payment-proof.response.js';

export class MembershipRequestController {
  public constructor(private readonly service: MembershipRequestService) {}
  public readonly list = async (request: Request, response: Response) => { const query = request.validated?.query as MembershipRequestListQuery; const result = await this.service.list(query); return sendCollection(response, result.data, { total: result.total, limit: query.limit, offset: query.offset, currentPage: Math.floor(query.offset / query.limit) + 1, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) }); };
  public readonly detail = async (request: Request, response: Response) => sendData(response, await this.service.detail((request.validated?.params as { id: number }).id));
  public readonly proof = async (request: Request, response: Response) => {
    const { requestId, paymentId } = request.validated?.params as { requestId: number; paymentId: number };
    const proof = await this.service.proof(requestId, paymentId);
    return sendPaymentProof(response, proof);
  };
  public readonly approve = async (request: Request, response: Response) => {
    const { id } = request.validated?.params as { id: number };
    const input = request.validated?.body as MembershipRequestApproveInput;
    return sendData(response, await this.service.approve(id, input.paymentId, request.auth!.userId));
  };
  public readonly reject = async (request: Request, response: Response) => {
    const { id } = request.validated?.params as { id: number };
    const input = request.validated?.body as MembershipRequestRejectInput;
    return sendData(response, await this.service.reject(id, input.paymentId, input.reason, request.auth!.userId));
  };
}
