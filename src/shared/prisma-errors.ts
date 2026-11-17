import { Prisma } from '@prisma/client';

export const isPrismaUniqueConstraintError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return true;
  if (!(error instanceof Error) || error.name !== 'DriverAdapterError') return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  return Boolean(cause && typeof cause === 'object' && (cause as { kind?: unknown }).kind === 'UniqueConstraintViolation');
};
