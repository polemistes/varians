/**
 * What the reader's page was not sent of its segments (the words each text
 * has at each place, and where each stands against the edition's words),
 * fetched for the segments a visitor opens and kept for the page's lifetime.
 * See `SegmentDetail` in `$lib/reader/wire`.
 */
import type { SegmentDetail } from '$lib/reader/wire';

/** How many segment ids go in one request, to keep URLs short. */
const CHUNK = 40;

export class SegmentDetails {
  /** By `url|segmentId`: the address the detail was asked at tells which state of the edition it is of. */
  #details = $state.raw<Record<string, SegmentDetail>>({});
  failed = $state(false);
  #pending = new Set<string>();

  get(url: string, segmentId: string): SegmentDetail | undefined {
    return this.#details[`${url}|${segmentId}`];
  }

  /** Fetch what is not loaded yet of these segments. */
  async load(url: string, segmentIds: string[]): Promise<void> {
    const missing = [...new Set(segmentIds)].filter((id) => {
      const key = `${url}|${id}`;
      return !(key in this.#details) && !this.#pending.has(key);
    });
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      for (const id of chunk) this.#pending.add(`${url}|${id}`);
      try {
        const joiner = url.includes('?') ? '&' : '?';
        const response = await fetch(
          `${url}${joiner}segments=${encodeURIComponent(chunk.join(','))}`,
        );
        if (!response.ok) throw new Error(response.statusText);
        const data = (await response.json()) as Record<string, SegmentDetail>;
        const next = { ...this.#details };
        // A segment the edition does not have gets an empty detail, so that it is not asked for again.
        for (const id of chunk) next[`${url}|${id}`] = data[id] ?? { units: {}, aligned: {} };
        this.#details = next;
        this.failed = false;
      } catch {
        this.failed = true;
      } finally {
        for (const id of chunk) this.#pending.delete(`${url}|${id}`);
      }
    }
  }
}
