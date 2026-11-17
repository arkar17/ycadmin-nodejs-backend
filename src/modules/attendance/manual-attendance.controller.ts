import type { Request, Response } from 'express';
import { sendData } from '../../shared/api-response.js';
import type { ManualAttendanceInput } from './manual-attendance.schema.js';
import type { ManualAttendanceService } from './manual-attendance.service.js';
export class ManualAttendanceController { public constructor(private readonly service: ManualAttendanceService) {} public readonly create = async (request: Request, response: Response) => sendData(response, await this.service.create(request.validated?.body as ManualAttendanceInput, request.auth!.userId), 201); }
