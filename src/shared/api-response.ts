import type { Response } from 'express';

export type Pagination = {
  total: number;
  limit: number;
  offset: number;
  currentPage: number;
  totalPages: number;
};

export const sendData = <T>(response: Response, data: T, status = 200): Response =>
  response.status(status).json({ data });

export const sendCollection = <T>(
  response: Response,
  data: T[],
  pagination: Pagination,
  status = 200,
): Response => response.status(status).json({ data, pagination });
