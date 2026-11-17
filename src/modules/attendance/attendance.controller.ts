import type { Request, Response } from 'express';
import { sendCollection } from '../../shared/api-response.js';
import type { AttendanceListQuery } from './attendance.schema.js';
import type { AttendanceService } from './attendance.service.js';
export class AttendanceController { public constructor(private readonly service: AttendanceService) {} public readonly list = async (request: Request, response: Response) => { const query = request.validated?.query as AttendanceListQuery; const result = await this.service.list(query); return sendCollection(response, result.data, { total: result.total, limit: query.limit, offset: query.offset, currentPage: Math.floor(query.offset / query.limit) + 1, totalPages: result.total === 0 ? 0 : Math.ceil(result.total / query.limit) }); }; }
