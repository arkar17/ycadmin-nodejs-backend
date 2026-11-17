import { AppError } from '../../shared/app-error.js';
import { yangonDateToUtcRange } from '../../shared/yangon-calendar.js';
import type { FeedbackListQueryInput } from './feedback.schema.js';
import type { FeedbackRecord, FeedbackRepository } from './feedback.repository.js';

export type FeedbackItem = {
  id: number;
  feedbackMessage: string;
  member: { id: number; name: string; clientCode: string };
  createdAt: string;
};

export class FeedbackService {
  public constructor(private readonly repository: FeedbackRepository) {}

  public async list(query: FeedbackListQueryInput): Promise<{ data: FeedbackItem[]; total: number }> {
    const page = await this.repository.findPage({
      memberName: query.name,
      clientCode: query.clientCode ?? query.client_code,
      ...(query.date ? { createdAt: yangonDateToUtcRange(query.date) } : {}),
      limit: query.limit,
      offset: query.offset,
    });
    return { data: page.records.map(this.toItem), total: page.total };
  }

  public async detail(id: number): Promise<FeedbackItem> {
    const feedback = await this.repository.findById(id);
    if (!feedback) {
      throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Feedback was not found.' });
    }
    return this.toItem(feedback);
  }

  private readonly toItem = (feedback: FeedbackRecord): FeedbackItem => ({
    id: feedback.id,
    feedbackMessage: feedback.name,
    member: {
      id: feedback.member.id,
      name: feedback.member.name,
      clientCode: feedback.member.code,
    },
    createdAt: feedback.createdAt.toISOString(),
  });
}
