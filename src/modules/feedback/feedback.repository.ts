import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type FeedbackRepositoryQuery = {
  memberName?: string;
  clientCode?: string;
  createdAt?: { start: Date; end: Date };
  limit: number;
  offset: number;
};

export type FeedbackRecord = {
  id: number;
  name: string;
  createdAt: Date;
  member: { id: number; name: string; code: string };
};

export type FeedbackPage = { records: FeedbackRecord[]; total: number };

export interface FeedbackRepository {
  findPage(query: FeedbackRepositoryQuery): Promise<FeedbackPage>;
  findById(id: number): Promise<FeedbackRecord | null>;
}

const createWhere = (query: FeedbackRepositoryQuery): Prisma.ClientFeedbackWhereInput => ({
  ...(query.memberName || query.clientCode
    ? {
        member: {
          is: {
            ...(query.memberName ? { name: { contains: query.memberName, mode: 'insensitive' } } : {}),
            ...(query.clientCode ? { code: { contains: query.clientCode, mode: 'insensitive' } } : {}),
          },
        },
      }
    : {}),
  ...(query.createdAt ? { createdAt: { gte: query.createdAt.start, lt: query.createdAt.end } } : {}),
});

const feedbackSelect = {
  id: true,
  name: true,
  createdAt: true,
  member: { select: { id: true, name: true, code: true } },
};

export class PrismaFeedbackRepository implements FeedbackRepository {
  public async findPage(query: FeedbackRepositoryQuery): Promise<FeedbackPage> {
    const prisma = getPrismaClient();
    const where = createWhere(query);
    const [records, total] = await prisma.$transaction([
      prisma.clientFeedback.findMany({
        where,
        select: feedbackSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
      prisma.clientFeedback.count({ where }),
    ]);
    return { records, total };
  }

  public async findById(id: number): Promise<FeedbackRecord | null> {
    return getPrismaClient().clientFeedback.findUnique({ where: { id }, select: feedbackSelect });
  }
}
