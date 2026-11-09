/**
 * Counting attempts in fixed windows, in memory: one Node process serves an
 * installation, so a map is enough. Used where a visitor could otherwise try
 * without end (passwords, registrations) or make the server work hard
 * (archive downloads).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Whether one more attempt is allowed now; counts it when it is. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      this.prune(now);
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }

  /** Forget a key, after a success. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  /** Seconds until the key may try again. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    return entry ? Math.max(0, Math.ceil((entry.reset - now) / 1000)) : 0;
  }

  private prune(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (entry.reset <= now) this.hits.delete(key);
  }
}

/**
 * The limits. Those per address are generous, since a whole seminar may sign
 * in from one university network; the limit per account is what stops the
 * guessing of a password.
 */
export const limits = {
  /** Logins from one address. */
  loginByAddress: new RateLimiter(100, 10 * 60_000),
  /** Logins to one account, from anywhere. */
  loginByAccount: new RateLimiter(10, 15 * 60_000),
  /** New accounts from one address. */
  registerByAddress: new RateLimiter(30, 60 * 60_000),
  /** Requests for a new password from one address. */
  resetByAddress: new RateLimiter(20, 60 * 60_000),
  /** Messages to one account (new passwords, confirmations), however asked for. */
  mailByAccount: new RateLimiter(3, 60 * 60_000),
  /** Archive downloads by one person. */
  archiveByUser: new RateLimiter(6, 60 * 60_000),
  /** Record addresses from one address: each looks a record up, and as JSON writes part of an archive. */
  recordsByAddress: new RateLimiter(300, 10 * 60_000),
  /** Previews and imports of packages by one person, on the import page and the push endpoint. */
  importsByUser: new RateLimiter(20, 60 * 60_000),
};
