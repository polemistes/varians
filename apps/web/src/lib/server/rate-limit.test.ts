import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.ts';

describe('RateLimiter', () => {
  it('allows so many attempts in a window, then refuses until it passes', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 10)).toBe(true);
    expect(limiter.take('a', 20)).toBe(false);
    expect(limiter.take('b', 20)).toBe(true);
    expect(limiter.retryAfter('a', 20)).toBe(1);
    expect(limiter.take('a', 1001)).toBe(true);
    limiter.clear('a');
    expect(limiter.take('a', 1002)).toBe(true);
  });
});
