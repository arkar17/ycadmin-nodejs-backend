import { Prisma } from '@prisma/client';

export const DEFAULT_SERIALIZABLE_ATTEMPTS = 3;

export const isRetryableSerializableConflict = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;

  // Prisma's driver-adapter path can surface PostgreSQL SQLSTATE 40001 at
  // interactive-transaction commit before mapping it to P2034.
  if (!(error instanceof Error) || error.name !== 'DriverAdapterError') return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const details = cause as { kind?: unknown; originalCode?: unknown };
  return details.kind === 'TransactionWriteConflict' && details.originalCode === '40001';
};

export const runWithSerializableRetry = async <T>(
  operation: () => Promise<T>,
  maxAttempts = DEFAULT_SERIALIZABLE_ATTEMPTS,
  onRetry?: (attempt: number, error: unknown) => void,
): Promise<T> => {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer.');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableSerializableConflict(error) || attempt === maxAttempts) throw error;
      onRetry?.(attempt, error);
    }
  }

  throw new Error('Serializable retry loop ended unexpectedly.');
};
