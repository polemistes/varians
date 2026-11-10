import { describe, expect, it } from 'vitest';
import { historyStrings } from '../strings/history.ts';
import { formatDay, formatSpan } from './time.ts';

const options = { locale: 'en-GB', timeZone: 'UTC', now: new Date('2026-10-02T16:00:00Z') };

describe('history times', () => {
  it('names today and yesterday, and dates further back', () => {
    expect(formatDay('2026-10-02T09:00:00Z', historyStrings, options)).toBe('Today');
    expect(formatDay('2026-10-01T09:00:00Z', historyStrings, options)).toBe('Yesterday');
    const long = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date('2026-09-20T09:00:00Z'),
    );
    expect(formatDay('2026-09-20T09:00:00Z', historyStrings, options)).toBe(long);
  });

  it('gives a span within a day once, across days twice, and an instant alone', () => {
    expect(
      formatSpan('2026-10-02T14:02:00Z', '2026-10-02T14:40:00Z', historyStrings, options),
    ).toBe('Today, 14:02 to 14:40');
    expect(
      formatSpan('2026-10-01T23:50:00Z', '2026-10-02T00:10:00Z', historyStrings, options),
    ).toBe('Yesterday, 23:50 to Today, 00:10');
    expect(
      formatSpan('2026-10-02T14:02:00Z', '2026-10-02T14:02:20Z', historyStrings, options),
    ).toBe('Today, 14:02');
  });
});
