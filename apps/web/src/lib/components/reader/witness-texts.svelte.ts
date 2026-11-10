/**
 * The texts of the witnesses beside the edition, fetched from the segments
 * API for the segments on screen and kept for the page's lifetime. Shared by
 * the witness panel (the words) and the facsimile panel (the page a word
 * stands on).
 */
import type { Item, Unit } from '@varians/core';

export interface WitnessRun {
  items: Item[];
  pageId: string | null;
  read: string;
  written: string;
}

export interface WitnessSegment {
  runs: WitnessRun[];
  units: Unit[];
}

/** How many segment ids go in one request, to keep URLs short. */
const CHUNK = 40;

export class WitnessTexts {
  /** By `transcriptionId|segmentId`. */
  segments = $state<Record<string, WitnessSegment>>({});
  keepsWrittenForm = $state<Record<string, boolean>>({});
  loading = $state(0);
  failed = $state(false);
  #pending = new Set<string>();

  get(transcriptionId: string, segmentId: string): WitnessSegment | undefined {
    return this.segments[`${transcriptionId}|${segmentId}`];
  }

  has(transcriptionId: string, segmentId: string): boolean {
    return `${transcriptionId}|${segmentId}` in this.segments;
  }

  /** Fetch what is not loaded yet of these segments. */
  async load(transcriptionId: string, segmentIds: string[]): Promise<void> {
    const missing = segmentIds.filter((id) => {
      const key = `${transcriptionId}|${id}`;
      return !(key in this.segments) && !this.#pending.has(key);
    });
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      for (const id of chunk) this.#pending.add(`${transcriptionId}|${id}`);
      this.loading++;
      try {
        const response = await fetch(
          `/api/transcriptions/${encodeURIComponent(transcriptionId)}/segments?ids=${encodeURIComponent(chunk.join(','))}`,
        );
        if (!response.ok) throw new Error(response.statusText);
        const data = (await response.json()) as {
          segments: Record<string, WitnessSegment>;
          keepsWrittenForm: boolean;
        };
        for (const id of chunk)
          this.segments[`${transcriptionId}|${id}`] = data.segments[id] ?? { runs: [], units: [] };
        this.keepsWrittenForm[transcriptionId] = data.keepsWrittenForm;
        this.failed = false;
      } catch {
        this.failed = true;
      } finally {
        for (const id of chunk) this.#pending.delete(`${transcriptionId}|${id}`);
        this.loading--;
      }
    }
  }

  /** The first token of a segment in a witness, once loaded. */
  firstToken(transcriptionId: string, segmentId: string): string | null {
    for (const run of this.get(transcriptionId, segmentId)?.runs ?? []) {
      for (const item of run.items) if (item.kind === 'token') return item.id;
    }
    return null;
  }

  /** The page a token stands on, from the page breaks of the loaded runs. */
  pageOf(transcriptionId: string, tokenId: string): string | null {
    const prefix = `${transcriptionId}|`;
    for (const [key, segment] of Object.entries(this.segments)) {
      if (!key.startsWith(prefix)) continue;
      for (const run of segment.runs) {
        let page = run.pageId;
        for (const item of run.items) {
          if (item.kind === 'break' && item.type === 'page') page = item.pageId ?? page;
          if (item.id === tokenId) return page;
        }
      }
    }
    return null;
  }

  /** Whether a token is among the loaded runs of a transcription. */
  holds(transcriptionId: string, tokenId: string): boolean {
    const prefix = `${transcriptionId}|`;
    for (const [key, segment] of Object.entries(this.segments)) {
      if (
        key.startsWith(prefix) &&
        segment.runs.some((run) => run.items.some((item) => item.id === tokenId))
      )
        return true;
    }
    return false;
  }
}
