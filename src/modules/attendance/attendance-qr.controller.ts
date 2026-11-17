import type { Request, Response } from 'express';

import { sendData } from '../../shared/api-response.js';
import type { AttendanceQrCredentialOperations, AttendanceQrCredentialValue } from './attendance-qr-credential.service.js';

const toResponse = (credential: AttendanceQrCredentialValue) => ({
  credentialId: credential.id,
  qrPayload: credential.payload,
  createdAt: credential.createdAt.toISOString(),
});

const preventCaching = (response: Response): void => {
  response.set('Cache-Control', 'no-store, private, max-age=0');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');
};

export class AttendanceQrController {
  public constructor(private readonly credentials: AttendanceQrCredentialOperations) {}

  public readonly create = async (request: Request, response: Response): Promise<Response> => {
    preventCaching(response);
    return sendData(response, toResponse(await this.credentials.create(request.auth!.userId)), 201);
  };

  public readonly retrieve = async (_request: Request, response: Response): Promise<Response> => {
    preventCaching(response);
    return sendData(response, toResponse(await this.credentials.retrieve()));
  };
}
