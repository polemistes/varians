/**
 * The size of a pane the user can resize: kept within limits and remembered
 * per browser under a key for each screen, so that a screen opens the way it
 * was left. Read from storage only once the page is live (`restore`), so that
 * the server's markup and the first render agree.
 */

const PREFIX = 'varians.pane.';

export interface PaneSizeOptions {
  /** The smallest and largest size, in pixels. */
  min: number;
  max: number;
  /** The size the server renders and the default without a better guess. */
  fallback: number;
  /** A default that depends on the window, computed in the browser. */
  initial?: () => number;
}

export class PaneSize {
  value = $state(0);
  readonly min: number;
  readonly max: number;
  readonly #key: string;
  readonly #fallback: number;
  readonly #initial: (() => number) | undefined;

  constructor(key: string, options: PaneSizeOptions) {
    this.#key = PREFIX + key;
    this.min = options.min;
    this.max = options.max;
    this.#fallback = options.fallback;
    this.#initial = options.initial;
    this.value = this.clamp(options.fallback);
  }

  clamp(size: number): number {
    return Math.round(Math.min(this.max, Math.max(this.min, size)));
  }

  /** The default size here and now. */
  get defaultSize(): number {
    return this.clamp(this.#initial?.() ?? this.#fallback);
  }

  /** Take the stored size, or the default, once the page is live. */
  restore(): void {
    const stored = Number(read(this.#key));
    this.value = Number.isFinite(stored) && stored > 0 ? this.clamp(stored) : this.defaultSize;
  }

  set(size: number): void {
    this.value = this.clamp(size);
    write(this.#key, String(this.value));
  }

  /** Back to the default, forgetting what was stored. */
  reset(): void {
    remove(this.#key);
    this.value = this.defaultSize;
  }
}

// Storage can be missing or refuse (private windows, blocked site data): sizes then simply are not remembered.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}
