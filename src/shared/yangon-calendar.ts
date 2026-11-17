/** Asia/Yangon has a fixed UTC+06:30 offset and does not observe daylight saving time. */
const yangonOffsetMilliseconds = 6.5 * 60 * 60 * 1000;

export const isIsoCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

/** Converts one Asia/Yangon calendar day to a half-open UTC instant range. */
export const yangonDateToUtcRange = (date: string): { start: Date; end: Date } => {
  if (!isIsoCalendarDate(date)) {
    throw new Error('Expected an ISO calendar date.');
  }

  const [year, month, day] = date.split('-').map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  const start = new Date(localMidnightAsUtc - yangonOffsetMilliseconds);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};
